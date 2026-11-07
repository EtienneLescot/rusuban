// Agents are headless Claude Code sessions (research R2, R3). Every run carries the built-in deny
// rules, whatever the host's permission profile: agents never merge, never push to a default branch
// and never edit the instance's state. The server is the only merger.
//
// A run is requested, then executed by a detached runner process, so it outlives the daemon that
// asked for it. Runs of one lock group go one after the other, in order of request.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homeDir, homePath, loadConfig, read, write } from "./home.mjs";

const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));

// ── Permissions ───────────────────────────────────────────────────────────────────────────────
// Claude Code path rules take POSIX paths, a Windows drive written /c: `Edit(//c/Users/…/**)`.
// An Edit rule also covers the Write tool (checked on Claude Code 2.1.302).
export function editRule(dir) {
	const posix = path
		.resolve(dir)
		.replace(/\\/g, "/")
		.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
	return `Edit(/${posix}/**)`;
}

// ponytail: deny rules match command text; an agent that hides a merge or a push behind a variable
// or another tool gets through. The server flags merges it did not make (research R3); an agent-only
// token without admin rights closes the gap later.
export function builtInDeny({ home = homeDir(), defaultBranches = [] } = {}) {
	const rules = [
		"Bash(gh pr merge*)",
		"Bash(gh api*merge*)", // REST /merge and /merges, GraphQL mergePullRequest
		"Bash(gh api*Merge*)", // GraphQL enablePullRequestAutoMerge and the like
		"Bash(git push*--all*)",
		"Bash(git push*--mirror*)",
		editRule(home),
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
	return rules;
}

// The owner's profile decides what agents may run on this host (FR-025); the built-in deny rules
// come on top of it, and the owner's own deny rules add to them, never replace them.
export function permissionArgs(permissions, context = {}) {
	const deny = [...builtInDeny(context), ...(permissions?.deny ?? [])];
	if (permissions?.mode === "bypass")
		return ["--dangerously-skip-permissions", "--disallowedTools", ...deny];
	if (permissions?.mode === "allowlist") {
		const allow = permissions.allow ?? [];
		return [
			"--permission-mode",
			"dontAsk",
			...(allow.length ? ["--allowedTools", ...allow] : []),
			"--disallowedTools",
			...deny,
		];
	}
	throw new Error('permissions.mode must be "bypass" or "allowlist"');
}

// ── One headless session ──────────────────────────────────────────────────────────────────────
const clock = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const short = (v, n = 160) => {
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return s.length > n ? `${s.slice(0, n)}…` : s;
};

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
		onDone?.(code, (result ?? "").trim() || "No final answer: see the log.", { denials });
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
		ids = fs.readdirSync(homePath("runs")).filter((d) => d !== "locks");
	} catch {}
	return ids
		.map(readRun)
		.filter((r) => r && (!project || r.project === project))
		.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

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
	if (!q.length || holder(lock)) return;
	write(queueName(lock), q.slice(1));
	runner.launch(q[0]);
}

// Asks for a run: started at once if its group is free and nobody waits, queued otherwise.
export function requestRun({
	kind,
	project,
	prompt,
	cwd,
	items = [],
	lock = `${project}.${kind}`,
	trigger = "manual",
	title = null,
}) {
	if (![kind, project, lock].every((s) => SAFE.test(s ?? "")))
		throw new Error("kind, project and lock are letters, digits, dots, dashes");
	if (!cwd || !fs.existsSync(cwd)) throw new Error(`the run's folder does not exist: ${cwd}`);
	const id = newRunId(kind);
	fs.mkdirSync(homePath(`runs/${id}`), { recursive: true });
	fs.writeFileSync(homePath(`runs/${id}/prompt.md`), prompt);
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

// Restarts queues whose holder died without handing over (a crash, a reboot).
export function kickQueues() {
	let files = [];
	try {
		files = fs.readdirSync(homePath("runs/locks")).filter((f) => f.endsWith(".queue.json"));
	} catch {}
	for (const f of files) startNext(f.slice(0, -".queue.json".length));
}

// The runner: takes the run's lock group, runs claude, writes the run's status. Resolves with the
// final status. `command` replaces the claude executable in tests.
export function executeRun(id, { config = loadConfig(), command } = {}) {
	return new Promise((resolve, reject) => {
		const s = read(statusName(id), null);
		if (!s) return reject(new Error(`no run ${id}`));
		if (s.state !== "queued") return resolve(s);
		// Arguments first: a bad permission profile fails here, before the run holds its lock group.
		const live = read(`projects/${s.project}/live.json`, {});
		const args = permissionArgs(config.permissions, {
			home: homeDir(),
			defaultBranches: Object.values(live.repos ?? {}).map((r) => r.defaultBranch),
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
		write(statusName(id), status);
		let flushTimer = null;
		const flush = () => {
			flushTimer = null;
			if (status.state === "running") write(statusName(id), status);
		};
		runClaude({
			prompt: fs.readFileSync(homePath(`runs/${id}/prompt.md`), "utf8"),
			cwd: s.cwd,
			logFile: homePath(`runs/${id}/${status.log}`),
			args,
			command,
			maxMinutes: config.limits?.maxRunMinutes,
			env: { ...process.env, RUSUBAN_HOME: homeDir(), RUSUBAN_RUN: id, RUSUBAN_PROJECT: s.project },
			onSession: (session) => {
				status.session = session;
				flush();
			},
			// The last sentence reads better than the last command: a tool shows only until one comes.
			onStep: (text, tool) => {
				if (!tool || !status.step) status.step = text.slice(0, 200);
				flushTimer ??= setTimeout(flush, 2000);
			},
			onDone: (code, summary, { denials }) => {
				clearTimeout(flushTimer);
				Object.assign(status, {
					state: code === 0 ? "done" : "failed",
					endedAt: new Date().toISOString(),
					exitCode: code,
					summary,
					denials,
				});
				write(statusName(id), status);
				releaseLock(s.lock, id);
				startNext(s.lock);
				resolve(status);
			},
		});
	});
}
