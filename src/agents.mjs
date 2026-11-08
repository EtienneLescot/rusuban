// Agents are headless Claude Code sessions (research R2, R3). Every run carries the built-in deny
// rules, whatever the host's permission profile: agents never merge, never push to a default branch
// and never edit the instance's state; in a shadow project they write nothing on GitHub. The server
// is the only merger. Every run goes through requestRun and executeRun (FR-030).
//
// A run is requested, then executed by a detached runner process, so it outlives the daemon that
// asked for it. Runs of one lock group go one after the other, in order of request. Its prompt is
// built when it starts, so a run that waited in a queue sees the latest state.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { append, homeDir, homePath, loadConfig, read, readJsonl, write } from "./home.mjs";
import { flatten, pendingAnswers, refusedOf, todoOf } from "./model.mjs";
import { prepareWorktree, removeWorktree } from "./workers.mjs";

const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
const PROMPTS = new URL("./prompts/", import.meta.url);
const firstLine = (e) =>
	String(e?.stderr || e?.message || e)
		.trim()
		.split("\n")[0];

// ── Permissions ───────────────────────────────────────────────────────────────────────────────
// Claude Code path rules take POSIX paths, a Windows drive written /c: `Edit(//c/Users/…/**)`.
// An Edit rule also covers the Write tool (checked on Claude Code 2.1.302).
export function editRule(target, folder = true) {
	const posix = path
		.resolve(target)
		.replace(/\\/g, "/")
		.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
	return `Edit(/${posix}${folder ? "/**" : ""})`;
}

// The instance's state under its home, denied to the agents' file tools. Their own folders there stay
// theirs: `scratch/` (judge, act, task) and the workers' `worktrees/` and `repos/`.
const STATE = [
	"config.json",
	"automerge.json",
	"projects",
	"runs",
	"hub",
	"leases",
	"tasks",
	"bin",
];

// Shadow projects (FR-028, research R3): agents judge and propose, every GitHub write is denied.
const GH_WRITES = {
	pr: "close comment create edit lock ready reopen review revert unlock update-branch",
	issue: "close comment create delete develop edit lock pin reopen transfer unlock unpin",
	label: "clone create delete edit",
	release: "create delete delete-asset edit upload",
	repo: "archive create delete deploy-key edit fork rename sync unarchive",
	run: "cancel delete rerun",
	workflow: "disable enable run",
	cache: "delete",
	secret: "delete set",
	variable: "delete set",
	gist: "create delete edit rename",
};
export const SHADOW_DENY = [
	...Object.entries(GH_WRITES).flatMap(([group, verbs]) =>
		verbs.split(" ").map((verb) => `Bash(gh ${group} ${verb}*)`),
	),
	// `gh api` writes with a method, or with fields or a body, which make it a POST: GraphQL reads
	// through `gh api graphql -f` are denied too in shadow mode.
	...["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input"].map(
		(flag) => `Bash(gh api* ${flag}*)`,
	),
	"Bash(git push*)",
];

// The commands of contracts/cli.md that belong to the owner; the agent CLI refuses them inside a run.
export const OWNER_COMMANDS = [
	"project",
	"task",
	"start",
	"permissions",
	"machine",
	"channel",
	"remote",
	"service",
	"init",
	"mcp",
];

// The files of the owner's settings and answers, denied to the shell too: whoever writes them answers
// a card or arms the switch. These names are Rusuban's own; `config.json` is denied only next to the
// home's name, being a common file name in the repos workers change.
const SHELL_STATE = ["automerge.json", "answers.jsonl", "pending.json"];

// ponytail: deny rules match command text; an agent that hides a merge or a push behind a variable
// or another tool gets through, and so does one that reaches the dashboard or the owner's files by a
// spelling the rules do not name. The server flags merges and pushes it did not make (research R3);
// an agent-only token, and agents under their own OS account or a sandbox, close the gap after v1.
export function builtInDeny({
	home = homeDir(),
	defaultBranches = [],
	shadow = false,
	port = null,
} = {}) {
	const rules = [
		"Bash(gh pr merge*)",
		"Bash(gh api*merge*)", // REST /merge and /merges, GraphQL mergePullRequest
		"Bash(gh api*Merge*)", // GraphQL enablePullRequestAutoMerge and the like
		"Bash(git push*--all*)",
		"Bash(git push*--mirror*)",
		// The owner's settings (FR-095): no agent makes a project live, turns its bypass on, starts a
		// task or reaches Rusuban's own MCP server.
		...OWNER_COMMANDS.map((c) => `Bash(rusuban ${c}*)`),
		"mcp__rusuban",
		...STATE.map((name) => editRule(path.join(home, name), !name.endsWith(".json"))),
		// The shell reaches neither the dashboard's API, on this machine or through the tailnet, nor
		// the owner's files: a speed bump under the bypass profile, not a barrier (docs/security.md).
		...(port ? [`Bash(*:${port}*)`] : []),
		"Bash(*.ts.net*)",
		`Bash(*${path.basename(home)}*config.json*)`,
		...SHELL_STATE.map((name) => `Bash(*${name}*)`),
	];
	for (const b of new Set(defaultBranches.filter(Boolean)))
		rules.push(
			`Bash(git push* ${b})`,
			`Bash(git push* ${b} *)`,
			`Bash(git push*:${b})`,
			`Bash(git push*:${b} *)`,
			`Bash(git push* +${b})`,
			`Bash(git push* +${b} *)`,
			`Bash(git push*refs/heads/${b}*)`,
			`Bash(gh api*git/refs/heads/${b}*)`,
		);
	if (shadow) rules.push(...SHADOW_DENY);
	return rules;
}

// The owner's profile decides what agents may run on this host (FR-025); the built-in deny rules
// come on top of it, and the owner's own deny rules add to them, never replace them. Only the owner's
// user settings load: a repo's own `.claude` settings (hooks, permissions) never reach a run, so
// whoever can merge in a repo gains no shell on the host. The agent CLI is allowed in both profiles:
// it is how every run reports.
export function permissionArgs(permissions, context = {}) {
	const deny = [...builtInDeny(context), ...(permissions?.deny ?? [])];
	const sources = ["--setting-sources", "user"];
	if (permissions?.mode === "bypass")
		return [...sources, "--dangerously-skip-permissions", "--disallowedTools", ...deny];
	if (permissions?.mode === "allowlist")
		return [
			...sources,
			"--permission-mode",
			"dontAsk",
			"--allowedTools",
			"Bash(rusuban *)",
			...(permissions.allow ?? []),
			"--disallowedTools",
			...deny,
		];
	throw new Error('permissions.mode must be "bypass" or "allowlist"');
}

// ── Prompts (contracts/project-files.md) ──────────────────────────────────────────────────────
const PARTS = {
	judge: ["judge", "formats"],
	act: ["act", "formats"],
	task: ["task", "formats"],
	worker: ["worker"],
	// A reply to a conversation is not assembled: the person's text goes as is to the resumed session.
	reply: [],
};
const promptOf = (name) => fs.readFileSync(new URL(`${name}.md`, PROMPTS), "utf8").trim();
export const coordinatorLock = (project) => `${project}.coordinator`;
export const scratchOf = (project) => homePath(`scratch/${project}`);

// What a coordinator run is handed: the answers to carry out, and the requests and worker reports no
// coordinator run has finished yet (`consumed.json` counts those done).
export function pendingOf(project) {
	const dir = `projects/${project}`;
	const done = read(`${dir}/consumed.json`, {});
	return {
		answers: pendingAnswers(
			read(`${dir}/judgment.json`, { items: {} }),
			readJsonl(`${dir}/answers.jsonl`),
		),
		asks: readJsonl(`${dir}/asks.jsonl`).slice(done.asks ?? 0),
		reports: readJsonl(`${dir}/reports.jsonl`).slice(done.reports ?? 0),
	};
}

const list = (items, line) => (items.length ? items.map(line) : ["None."]);
const STARTED = {
	schedule: "at its time",
	button: "by the owner, from the dashboard",
	manual: "by the owner, from the command line",
	retry: "again, its last run having been cut short",
};

function contextOf({ p, kind, run, config, pending, task }) {
	const dir = `projects/${p.id}`;
	const live = read(`${dir}/live.json`, { repos: {} });
	const rules = read(`${dir}/rules.json`, {});
	const judgment = read(`${dir}/judgment.json`, { items: {} });
	const shadow = p.mode === "shadow";
	const out = [
		"# Context",
		"",
		`- Project: ${p.title} (\`${p.id}\`), ${shadow ? "in shadow mode: judge and propose only, every GitHub write is denied and nothing is merged" : "live"}.`,
		`- Owner: @${config.owner.login}.`,
		...p.repos.map(({ slug }) => {
			const r = rules[slug];
			const locks = r?.errors?.length
				? `an invalid locks.json (${r.errors.join("; ")}), so nothing merges`
				: r?.locks
					? `locks \`${JSON.stringify(r.locks)}\``
					: "no locks.json";
			const own = r?.files?.length ? `rules ${r.files.map((f) => f.name).join(", ")}` : "no rules";
			return `- Repo ${slug}: default branch \`${live.repos?.[slug]?.defaultBranch ?? "unknown"}\`, ${own}, ${locks}.`;
		}),
		`- Machines: ${config.machines?.length ? config.machines.map((m) => m.name).join(", ") : "none registered"}.`,
		`- This run: \`${run}\`, a ${kind} run${task ? ` of the task \`${task.id}\` (“${task.title}”), started ${STARTED[task.trigger] ?? task.trigger}` : ""}. The agent CLI is \`rusuban\` (also \`node "${BIN}"\`).`,
		"",
		"## Open cards",
		"",
		...list(
			Object.entries(judgment.items ?? {}).filter(([, j]) => j.decision && !j.decision.resolvedAt),
			([k, j]) => `- ${k}, to @${j.decision.to}: ${j.decision.q}`,
		),
	];
	if (pending)
		out.push(
			"",
			"## Answers to carry out",
			"",
			...list(pending.answers, (a) => {
				const o = a.chosen;
				const chose = o
					? `chose "${o.label}"${o.merge ? ", a merge order the server carries out" : ""}. Effect: ${o.effect}${o.message ? ` Message: ${o.message}` : ""}`
					: "answered freely";
				return `- ${a.item}, card \`${a.card}\` ("${a.q}"): @${a.by ?? config.owner.login} ${chose}${a.note ? ` Note: ${a.note}` : ""}`;
			}),
			"",
			"## Requests from the owner",
			"",
			...list(pending.asks, (a) => `- ${a.at}${a.item ? `, on ${a.item}` : ""}: ${a.text}`),
			"",
			"## Worker reports",
			"",
			...list(
				pending.reports,
				(r) =>
					`- Worker \`${r.worker}\` (run \`${r.run}\`) on ${r.item} ended ${r.state}: ${r.text}`,
			),
		);
	return out.join("\n");
}

// A run's prompt: the product prompt of its kind, the safety frame, the project's rules verbatim with
// their source, the context, then the run's own mission or task.
export function assemblePrompt({
	kind,
	project,
	mission = "",
	config,
	run,
	pending = null,
	task = null,
}) {
	const p = config.projects.find((x) => x.id === project);
	if (!p) throw new Error(`unknown project "${project}"`);
	const rules = read(`projects/${project}/rules.json`, {});
	const parts = [...PARTS[kind].map(promptOf), promptOf("frame")];
	const ruled = p.repos.map((r) => r.slug).filter((s) => rules[s]?.files?.length);
	for (const slug of ruled)
		parts.push(
			[
				`# Project rules: ${slug}@${rules[slug].treeSha}:.rusuban/rules/`,
				...rules[slug].files.map((f) => `## ${f.name}\n\n${f.text.trim()}`),
			].join("\n\n"),
		);
	if (!ruled.length)
		parts.push(
			"# Project rules\n\nNo repo of this project has rules yet: do nothing autonomous. Only the owner's own requests and answers in the context are yours to carry out.",
		);
	parts.push(contextOf({ p, kind, run, config, pending, task }));
	if (mission.trim())
		parts.push(`# Your ${kind === "task" ? "task" : "mission"}\n\n${mission.trim()}`);
	return `${parts.join("\n\n---\n\n")}\n`;
}

// ── One headless session ──────────────────────────────────────────────────────────────────────
const clock = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const short = (v, n = 160) => {
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return s.length > n ? `${s.slice(0, n)}…` : s;
};

// A Claude usage limit, as `claude -p` reports it, with the reset time when the message gives one
// (research R14): "…limit reached|1767225600", or "…resets 3pm".
export function usageLimitOf(text, now = new Date()) {
	const s = String(text ?? "");
	if (!/usage limit|limit reached|hit your limit|limit will reset/i.test(s)) return null;
	const epoch = /\|(\d{10})\b/.exec(s);
	if (epoch) return { resetAt: new Date(Number(epoch[1]) * 1000).toISOString() };
	const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s);
	if (!m) return { resetAt: null };
	const at = new Date(now);
	const pm = m[3]?.toLowerCase() === "pm";
	at.setHours((Number(m[1]) % (m[3] ? 12 : 24)) + (pm ? 12 : 0), Number(m[2] ?? 0), 0, 0);
	if (at <= now) at.setDate(at.getDate() + 1);
	return { resetAt: at.toISOString() };
}

// `claude -p` with the prompt on stdin (no command-line length limit), stream-json so each step
// is written as it comes, in plain words and timestamped, to the log the dashboard shows live.
export function runClaude({
	prompt,
	cwd,
	logFile,
	args = [],
	env = process.env,
	command = ["claude"],
	maxMinutes = 150,
	onSession,
	onStep,
	onDone,
}) {
	const log = fs.openSync(logFile, "a");
	const line = (text) => fs.writeSync(log, `${clock()}  ${text}\n`);
	const [cmd, ...pre] = command;
	const child = spawn(cmd, [...pre, "-p", "--output-format", "stream-json", "--verbose", ...args], {
		cwd,
		env,
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	child.stdin.on("error", () => {}); // claude may exit before it reads its prompt
	child.stdin.end(prompt);
	// ponytail: a timeout kills claude, not the tools it started; kill the process tree if one hangs.
	const killer = setTimeout(() => child.kill(), maxMinutes * 60000);
	let result = null;
	let denials = [];
	let limit = null;
	const onEvent = (e) => {
		// The session id: `claude --resume <id>` in the same folder reopens the conversation.
		if (e.type === "system" && e.subtype === "init" && e.session_id) onSession?.(e.session_id);
		if (e.type === "assistant")
			for (const c of e.message?.content ?? []) {
				if (c.type === "text" && c.text.trim()) {
					const text = c.text.trim().replace(/\n+/g, " ⏎ ");
					line(text);
					onStep?.(text, false);
				}
				if (c.type === "tool_use") {
					const i = c.input ?? {};
					line(
						`→ ${c.name} ${short(i.command ?? i.description ?? i.file_path ?? i.pattern ?? i.prompt ?? i)}`,
					);
					onStep?.(`using ${c.name}`, true);
				}
			}
		if (e.type === "result") {
			// Not yet the end: with a background task, claude -p hands back to the model, which writes
			// another answer. The end is the process exit.
			result = e.result ?? null;
			if (e.is_error) limit = usageLimitOf(result);
			denials = (e.permission_denials ?? []).map((d) => ({
				tool: d.tool_name,
				input: short(d.tool_input?.command ?? d.tool_input?.file_path ?? d.tool_input, 200),
			}));
			for (const d of denials) line(`denied: ${d.tool} ${d.input}`);
			line(
				`result: ${e.is_error ? "error" : "ok"}, ${Math.round((e.duration_ms ?? 0) / 1000)} s, ${e.num_turns ?? "?"} turns`,
			);
		}
	};
	let buf = "";
	child.stdout.setEncoding("utf8"); // a character split across two chunks stays whole
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		buf += chunk;
		const lines = buf.split("\n");
		buf = lines.pop();
		for (const l of lines) {
			if (!l.trim()) continue;
			try {
				onEvent(JSON.parse(l));
			} catch {
				line(l);
			}
		}
	});
	child.stderr.on("data", (chunk) => line(`[stderr] ${String(chunk).trim()}`));
	let finished = false;
	const finish = (code) => {
		if (finished) return; // "error" then "close" can both arrive
		finished = true;
		clearTimeout(killer);
		fs.closeSync(log);
		onDone?.(code, (result ?? "").trim() || "No final answer: see the log.", { denials, limit });
	};
	child.on("error", (e) => {
		line(`could not start ${cmd}: ${e.message}`);
		finish(-1);
	});
	child.on("close", (code) => finish(code ?? -1));
	return child;
}

// ── Runs, lock groups and their queues ────────────────────────────────────────────────────────
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === "EPERM";
	}
};
const SAFE = /^[\w.-]+$/;
const statusName = (id) => `runs/${id}/status.json`;
const lockName = (lock) => `runs/locks/${lock}.json`;
const queueName = (lock) => `runs/locks/${lock}.queue.json`;
// The account's usage limit: every queue holds until it resets.
const LIMIT = "runs/limit.json";
const limitedUntil = () => Date.parse(read(LIMIT, {}).until ?? 0) || 0;
const BACKOFF_MIN = [5, 15, 60];
// Thrown past the prompt assembly by a reply, whose prompt is the person's own text.
const REPLY = Symbol("reply");

export const newRunId = (kind) =>
	`${kind}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex")}`;

// Who holds a lock group, if that process still lives: { pid, run, since }.
export function holder(lock) {
	const h = read(lockName(lock), null);
	return h && alive(h.pid) ? h : null;
}
export const queued = (lock) => read(queueName(lock), []);

export function readRun(id) {
	const s = read(statusName(id), null);
	if (s?.state === "running" && !alive(s.pid)) s.state = "interrupted";
	return s;
}

export function listRuns(project = null) {
	let ids = [];
	try {
		ids = fs.readdirSync(homePath("runs")).filter((d) => d !== "locks" && !d.endsWith(".json"));
	} catch {}
	return ids
		.map(readRun)
		.filter((r) => r && (!project || r.project === project))
		.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

// A run of this kind for the project that waits or works.
export const busy = (project, kind, states = ["queued", "running"]) =>
	listRuns(project).some((r) => r.kind === kind && states.includes(r.state));

// How a runner process starts; tests replace it.
export const runner = {
	launch: (id) =>
		spawn(process.execPath, [BIN, "_run", id], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			env: { ...process.env, RUSUBAN_HOME: homeDir() },
		}).unref(),
};

const enqueue = (lock, id) => {
	const q = queued(lock);
	if (!q.includes(id)) write(queueName(lock), [...q, id]);
};

export function startNext(lock) {
	const q = queued(lock);
	if (!q.length || holder(lock) || limitedUntil() > Date.now()) return;
	write(queueName(lock), q.slice(1));
	runner.launch(q[0]);
}

// Asks for a run: started at once if its group is free and nobody waits, queued otherwise. A worker's
// folder is made when it starts; the other kinds work in the project's scratch folder.
export function requestRun({
	kind,
	project,
	mission = "",
	items = [],
	lock = `${project}.${kind}`,
	trigger = "manual",
	title = null,
	cwd = null,
	attempt = 1,
	retryOf = null,
	task = null,
	resume = null,
	fork = false,
}) {
	if (!PARTS[kind]) throw new Error(`a run is ${Object.keys(PARTS).join(", ")}`);
	if (![project, lock].every((s) => SAFE.test(s ?? "")))
		throw new Error("project and lock are letters, digits, dots, dashes");
	if (cwd && !fs.existsSync(cwd)) throw new Error(`the run's folder does not exist: ${cwd}`);
	const id = newRunId(kind);
	fs.mkdirSync(homePath(`runs/${id}`), { recursive: true });
	fs.writeFileSync(homePath(`runs/${id}/mission.md`), mission);
	write(statusName(id), {
		id,
		kind,
		title,
		project,
		items,
		session: null,
		cwd,
		worktree: null,
		leases: [],
		trigger,
		lock,
		attempt,
		retryOf,
		task,
		...(resume ? { resume, forkOf: fork ? resume : null } : {}),
		state: "queued",
		createdAt: new Date().toISOString(),
		startedAt: null,
		endedAt: null,
		exitCode: null,
		pid: null,
		log: null,
		step: null,
		summary: null,
	});
	enqueue(lock, id);
	startNext(lock);
	return { id, state: queued(lock).includes(id) ? "queued" : "started" };
}

// A coordinator run, unless one already waits: it will see everything new when it starts.
export function requestCoordinator(project, trigger) {
	if (busy(project, "act", ["queued"])) return null;
	return requestRun({ kind: "act", project, lock: coordinatorLock(project), trigger });
}

// ponytail: a dead holder's lock is taken over without compare-and-swap; two runners starting in the
// same instant right after a crash could both run. Rename the stale lock first if that ever bites.
function takeLock(lock, id) {
	if (holder(lock)) return false;
	const file = homePath(lockName(lock));
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.rmSync(file, { force: true });
	try {
		fs.writeFileSync(
			file,
			JSON.stringify({ pid: process.pid, run: id, since: new Date().toISOString() }),
			{ flag: "wx" },
		);
		return true;
	} catch {
		return false;
	}
}

function releaseLock(lock, id) {
	if (read(lockName(lock), null)?.run === id) fs.rmSync(homePath(lockName(lock)), { force: true });
}

const killTree = (pid) => {
	try {
		if (process.platform === "win32")
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
		else process.kill(-pid, "SIGKILL"); // the runner leads its own process group (detached)
	} catch {}
};

const slugOf = (run) => run.items?.[0]?.split("#")[0];

// Stops a run: a queued one leaves its queue, a running one dies with its process tree first, so its
// runner writes nothing after this.
export function stopRun(id, why = "Stopped.") {
	const s = readRun(id);
	if (!s || !["queued", "running"].includes(s.state)) return s;
	if (s.state === "queued")
		write(
			queueName(s.lock),
			queued(s.lock).filter((x) => x !== id),
		);
	else killTree(s.pid);
	const stopped = { ...s, state: "stopped", endedAt: new Date().toISOString(), summary: why };
	write(statusName(id), stopped);
	if (s.worktree) removeWorktree(s.worktree, slugOf(s));
	releaseLock(s.lock, id);
	startNext(s.lock);
	return stopped;
}

// Every cycle of the daemon: once the usage limit resets, a run it stopped is asked again; a run
// whose runner died (a crash, a reboot) gives its work back to the queue, twice at most; then every
// queue whose holder died starts its next run.
export function kickQueues(now = Date.now()) {
	if (limitedUntil() > now) return;
	for (const r of listRuns()) {
		if (r.retriedBy) continue;
		const due = r.state === "limited" && Date.parse(r.retryAt) <= now;
		const lost = r.state === "interrupted" && (r.attempt ?? 1) < 3;
		if (!due && !lost) continue;
		if (lost && r.worktree) removeWorktree(r.worktree, slugOf(r));
		let mission = "";
		try {
			mission = fs.readFileSync(homePath(`runs/${r.id}/mission.md`), "utf8");
		} catch {}
		const again = requestRun({
			kind: r.kind,
			project: r.project,
			mission,
			items: r.items,
			lock: r.lock,
			trigger: "retry",
			title: r.title,
			cwd: r.kind === "worker" ? null : r.cwd,
			attempt: (r.attempt ?? 1) + 1,
			retryOf: r.id,
			task: r.task ?? null,
			resume: r.resume ?? null,
			fork: !!r.forkOf,
		});
		write(statusName(r.id), { ...r, retriedBy: again.id });
	}
	let files = [];
	try {
		files = fs.readdirSync(homePath("runs/locks")).filter((f) => f.endsWith(".queue.json"));
	} catch {}
	for (const f of files) startNext(f.slice(0, -".queue.json".length));
}

// `rusuban` on the PATH of every run, whatever installed it: a shell script for Git Bash, macOS and
// Linux, a .cmd for Windows shells.
function shimDir() {
	const dir = homePath("bin");
	fs.mkdirSync(dir, { recursive: true });
	const posix = (p) => p.replace(/\\/g, "/");
	fs.writeFileSync(
		path.join(dir, "rusuban"),
		`#!/bin/sh\nexec "${posix(process.execPath)}" "${posix(BIN)}" "$@"\n`,
		{ mode: 0o755 },
	);
	fs.writeFileSync(path.join(dir, "rusuban.cmd"), `@"${process.execPath}" "${BIN}" %*\r\n`);
	return dir;
}

function runEnv(id, project) {
	const env = {
		...process.env,
		RUSUBAN_HOME: homeDir(),
		RUSUBAN_RUN: id,
		RUSUBAN_PROJECT: project,
	};
	const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	env[key] = `${shimDir()}${path.delimiter}${env[key] ?? ""}`;
	return env;
}

// The runner: takes the run's lock group, builds its prompt and folder, runs claude, writes the run's
// status. Resolves with the final status. `command` replaces the claude executable in tests.
export function executeRun(id, { config = loadConfig(), command } = {}) {
	return new Promise((resolve, reject) => {
		const s = read(statusName(id), null);
		if (!s) return reject(new Error(`no run ${id}`));
		if (s.state !== "queued") return resolve(s);
		// Arguments first: a bad permission profile fails here, before the run holds its lock group.
		const live = read(`projects/${s.project}/live.json`, {});
		const mode = config.projects?.find((p) => p.id === s.project)?.mode;
		const args = permissionArgs(config.permissions, {
			home: homeDir(),
			defaultBranches: Object.values(live.repos ?? {}).map((r) => r.defaultBranch),
			shadow: mode !== "live", // a project no longer configured gets the shadow rules too
			port: config.port,
		});
		if (!takeLock(s.lock, id)) {
			enqueue(s.lock, id);
			return resolve(readRun(id));
		}
		const startedAt = new Date().toISOString();
		const status = {
			...s,
			state: "running",
			startedAt,
			pid: process.pid,
			log: `${startedAt.replace(/[:.]/g, "-")}.log`,
		};
		const end = (fields) => {
			Object.assign(status, { endedAt: new Date().toISOString(), ...fields });
			write(statusName(id), status);
			// A worker's final answer is a report for the coordinator, which starts at once.
			if (s.kind === "worker" && ["done", "failed"].includes(status.state)) {
				append(`projects/${s.project}/reports.jsonl`, {
					at: status.endedAt,
					run: id,
					worker: s.title,
					item: s.items[0],
					state: status.state,
					text: status.summary,
					session: status.session,
				});
				requestCoordinator(s.project, "worker");
			}
			if (status.worktree) removeWorktree(status.worktree, slugOf(s));
			releaseLock(s.lock, id);
			startNext(s.lock);
			resolve(status);
		};
		let prompt;
		let pending = null;
		try {
			if (s.kind === "worker") {
				const slug = slugOf(s);
				status.worktree = prepareWorktree({
					slug,
					branch: live.repos?.[slug]?.defaultBranch,
					project: s.project,
					run: id,
				});
				status.cwd = status.worktree;
			}
			status.cwd ??= scratchOf(s.project);
			fs.mkdirSync(status.cwd, { recursive: true });
			if (s.kind === "reply") {
				prompt = fs.readFileSync(homePath(`runs/${id}/mission.md`), "utf8");
				fs.writeFileSync(homePath(`runs/${id}/prompt.md`), prompt);
				throw REPLY;
			}
			if (s.kind === "act") pending = pendingOf(s.project);
			// A run asked for while another worked may find its work done: it ends without a session.
			const dir = `projects/${s.project}`;
			const idle =
				s.kind === "act"
					? !(pending.answers.length || pending.asks.length || pending.reports.length)
					: s.kind === "judge" &&
						!todoOf({
							live: flatten(live),
							judgment: read(`${dir}/judgment.json`, { items: {} }),
							rules: read(`${dir}/rules.json`, {}),
							refused: refusedOf(readJsonl(`${dir}/journal.jsonl`)),
						}).length;
			if (idle)
				return end({
					state: "done",
					exitCode: 0,
					summary: `Nothing ${s.kind === "act" ? "waited" : "to judge"} when the run started.`,
				});
			prompt = assemblePrompt({
				kind: s.kind,
				project: s.project,
				mission: fs.readFileSync(homePath(`runs/${id}/mission.md`), "utf8"),
				config,
				run: id,
				pending,
				task: s.task ? { id: s.task, title: s.title, trigger: s.trigger } : null,
			});
			fs.writeFileSync(homePath(`runs/${id}/prompt.md`), prompt);
		} catch (e) {
			if (e !== REPLY)
				return end({ state: "failed", exitCode: -1, summary: `Could not start: ${firstLine(e)}` });
		}
		write(statusName(id), status);
		let flushTimer = null;
		const flush = () => {
			flushTimer = null;
			if (status.state === "running") write(statusName(id), status);
		};
		runClaude({
			prompt,
			cwd: status.cwd,
			logFile: homePath(`runs/${id}/${status.log}`),
			// A reply resumes its session, in place, or as a fork that leaves the original as it was.
			args: s.resume
				? [...args, "--resume", s.resume, ...(s.forkOf ? ["--fork-session"] : [])]
				: args,
			command,
			maxMinutes: config.limits?.maxRunMinutes,
			env: runEnv(id, s.project),
			onSession: (session) => {
				status.session = session;
				flush();
			},
			// The last sentence reads better than the last command: a tool shows only until one comes.
			onStep: (text, tool) => {
				if (!tool || !status.step) status.step = text.slice(0, 200);
				flushTimer ??= setTimeout(flush, 2000);
			},
			onDone: (code, summary, { denials, limit }) => {
				clearTimeout(flushTimer);
				const dir = `projects/${s.project}`;
				if (limit) {
					// The account is limited: this run is asked again at the reset, and every queue holds.
					const wait = BACKOFF_MIN[Math.min(s.attempt ?? 1, BACKOFF_MIN.length) - 1];
					const retryAt = limit.resetAt ?? new Date(Date.now() + wait * 60000).toISOString();
					write(LIMIT, { until: retryAt, run: id });
					return end({ state: "limited", retryAt, exitCode: code, summary, denials });
				}
				const state = code === 0 ? "done" : "failed";
				// A coordinator run that ended well has handled what it was given; a failed one leaves it
				// to the next.
				if (s.kind === "act" && state === "done") {
					const done = read(`${dir}/consumed.json`, {});
					write(`${dir}/consumed.json`, {
						asks: (done.asks ?? 0) + pending.asks.length,
						reports: (done.reports ?? 0) + pending.reports.length,
					});
				}
				end({ state, exitCode: code, summary, denials });
			},
		});
	});
}
