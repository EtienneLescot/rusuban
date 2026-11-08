#!/usr/bin/env node
// The rusuban command. Agent commands run inside a run, which sets RUSUBAN_RUN and RUSUBAN_PROJECT;
// they are the only writers of a project's judgment file and agent log, and each validates against the
// live state and takes a short lock before writing (specs/001-autopilot/contracts/cli.md).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { executeRun, listRuns, OWNER_COMMANDS, readRun } from "../src/agents.mjs";
import { agentLog, homePath, loadConfig, read, readJsonl, write } from "../src/home.mjs";
import {
	applyEvidence,
	applyJudgment,
	closeCard,
	flatten,
	inputKey,
	keyOf,
	parseItem,
	pendingAnswers,
	refusedOf,
	todoOf,
} from "../src/model.mjs";
import { dashboardUrl, messageOf, sendPing } from "../src/pings.mjs";
import { changeSetting, MODE_SAYS, maskTarget, planOf } from "../src/settings.mjs";
import { busyRun, listTasks, readTask, startTask, tasksState } from "../src/tasks.mjs";
import { listWorkers, startWorker, stopWorker } from "../src/workers.mjs";

const { version } = JSON.parse(
	fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const out = (v) => console.log(JSON.stringify(v, null, 1));

const USAGE = `rusuban ${version}

  start [--dry]                 runs the daemon and its dashboard in the foreground
  mcp                           Rusuban's MCP server on stdio, for Claude (every setting, the state)
  project add <owner/repo> [--checkout <path>] [--to <project>]
                                adds a repo, to a new project (in shadow mode) or to an existing one
  project list | project remove <id>
                                the projects; one removed, its files kept
  project mode <id> <live|shadow>
                                shadow: agents judge and propose, no GitHub write, no merge
  project bypass <id> <on|off>  merges with --admin what the server merges anyway, once every
                                check the base branch requires is green on the head
  permissions <bypass|allowlist>
                                the host profile: what agents may run on this machine
  channel add <type> <target> [--urgency now,digest] [--quiet HH:MM-HH:MM] [--digest HH:MM]
          | channel list | channel test <id> | channel remove <id>
                                where cards ping you: ntfy, Slack, Discord, Teams, e-mail
A change that widens what agents may do is confirmed by typing its target in a terminal; without a
terminal (Claude's shell, a script) it waits as a card in the dashboard's inbox.
  task list | task run <id>     the recurring tasks (tasks/<id>.md in the instance home), or one
                                started now
  task add <file.md> | task remove <id>
                                a task written into the instance (it widens: confirmed), or set aside

Agent commands, inside a run (an item is owner/repo#n, or #n when the project has one repo):
  todo                          what the agents must do, each with its reason
  show <item>                   live state and judgment of an item
  judge <file.json>             writes judgments: one object or a list
  resolve <item> <text>         closes an item's open card, saying what happened
  evidence <item> <todo|running|ok|fail> [url]
                                records a proof for the live head; a worker run only
  log <kind> <item|-> <text> [url]
  answers | asks                answers and requests not handled yet
  worker start <name> <item> <mission.md> | worker stop <name> | worker list`;

function project() {
	const config = loadConfig();
	const wanted =
		process.env.RUSUBAN_PROJECT || (config.projects.length === 1 ? config.projects[0].id : null);
	const p = config.projects.find((x) => x.id === wanted);
	if (!p)
		throw new Error(
			wanted
				? `unknown project "${wanted}"`
				: "set RUSUBAN_PROJECT: this instance has several projects",
		);
	// A run writes its own project's files only: RUSUBAN_PROJECT does not point it at another one.
	const run = process.env.RUSUBAN_RUN ? readRun(process.env.RUSUBAN_RUN) : null;
	if (run && run.project !== p.id)
		throw new Error(`run ${run.id} works for project ${run.project}, not ${p.id}`);
	const dir = `projects/${p.id}`;
	return {
		id: p.id,
		dir,
		repos: p.repos.map((r) => r.slug),
		live: () => flatten(read(`${dir}/live.json`, {})),
		judgment: () => read(`${dir}/judgment.json`, { items: {} }),
		by: process.env.RUSUBAN_RUN ? `agent:${process.env.RUSUBAN_RUN}` : "agent",
	};
}

// A judge, a worker and the coordinator may write at once: a short lock keeps one write from
// erasing another. A lock older than 10 s belongs to a dead writer and is taken over.
function withLock(p, fn) {
	const dir = homePath(`${p.dir}/judgment.lock`);
	fs.mkdirSync(homePath(p.dir), { recursive: true });
	const until = Date.now() + 10_000;
	for (;;) {
		try {
			fs.mkdirSync(dir);
			break;
		} catch {
			if (Date.now() > until) fs.rmSync(dir, { recursive: true, force: true });
			else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
		}
	}
	try {
		return fn();
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const TASK_USAGE = "usage: task list | task run <id> | task add <file.md> | task remove <id>";

// ── Projects and the host profile (the owner's) ───────────────────────────────────────────────
const PROJECT_USAGE =
	"usage: project add <owner/repo> [--checkout <path>] [--to <project>] | project list | project remove <id> | project mode <id> <live|shadow> | project bypass <id> <on|off>";

// The daemon reads config.json again when it changes. Whether the one running applied the change is
// asked on its own port, so the command says it rather than promise it.
async function daemonApplied(config, id, applied) {
	const at = `127.0.0.1:${config.port}`;
	const until = Date.now() + 8000;
	for (;;) {
		let state;
		try {
			const res = await fetch(`http://${at}/api/state?project=${id ?? ""}`, {
				signal: AbortSignal.timeout(2000),
			});
			state = await res.json();
		} catch {
			return `No daemon answers on ${at}: this applies when it starts.`;
		}
		if (applied(state)) return "The running daemon applied it.";
		if (Date.now() > until) return `The daemon on ${at} has not applied it: restart it.`;
		await new Promise((r) => setTimeout(r, 250));
	}
}

// One setting through the settings module (src/settings.mjs). In a terminal, a change that widens what
// agents may do is applied once its target is typed back; without one (Claude's shell, a script), it
// waits as a card the owner allows in the dashboard (FR-092).
async function setting(change, target, applied) {
	const config = loadConfig();
	const by = config.owner.login;
	const terminal = process.stdin.isTTY && process.stdout.isTTY;
	let confirmed = false;
	if (terminal) {
		const plan = planOf(config, change);
		if (plan.widens) {
			console.log(`${plan.card.q}\n${plan.card.ctx}`);
			const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
			const typed = (await rl.question(`Type "${target}" to confirm: `)).trim();
			rl.close();
			if (typed !== target) return console.log("Not confirmed: nothing changed.");
			confirmed = true;
		}
	}
	const r = changeSetting(change, { origin: terminal ? "terminal" : "cli", by, confirmed });
	console.log(r.text);
	if (r.state === "pending")
		return console.log(
			"It waits for your confirmation: a card in the dashboard's inbox. Nothing changes until you allow it there.",
		);
	if (r.state === "applied")
		console.log(await daemonApplied(config, change.project ?? change.to ?? null, applied));
}

async function projectCommand([sub, ...args]) {
	if (sub === "list" && !args.length) return out(loadConfig().projects);
	if (sub === "add") {
		const { values, positionals } = parseArgs({
			args,
			options: { checkout: { type: "string" }, to: { type: "string" } },
			allowPositionals: true,
		});
		const [slug, extra] = positionals;
		if (!slug || extra) throw new Error(PROJECT_USAGE);
		const change = {
			kind: "project.add",
			slug,
			checkout: values.checkout ?? null,
			to: values.to ?? null,
		};
		const id = values.to ?? planOf(loadConfig(), change).project;
		return setting(change, values.to ?? slug, (s) =>
			values.to ? s.project?.repos?.includes(slug) : s.projects?.some((p) => p.id === id),
		);
	}
	if (sub === "remove" && args.length === 1) {
		const id = args[0];
		await setting(
			{ kind: "project.remove", project: id },
			id,
			(s) => !s.projects?.some((p) => p.id === id),
		);
		// Nothing is deleted: a project added again under the same id finds its state where it was.
		const kept = ["projects", "scratch", "worktrees"]
			.map((d) => homePath(`${d}/${id}`))
			.filter((d) => fs.existsSync(d));
		if (kept.length) console.log(`Its files stay in:\n${kept.map((d) => `  ${d}`).join("\n")}`);
		for (const t of listTasks(loadConfig()).filter((x) => x.project === id))
			console.log(
				`Task ${t.id} names it and will not run: edit or delete ${homePath(`tasks/${t.id}.md`)}`,
			);
		return;
	}
	if (sub === "mode" && args.length === 2) {
		const [id, mode] = args;
		if (!Object.hasOwn(MODE_SAYS, mode)) throw new Error(PROJECT_USAGE);
		await setting(
			{ kind: "project.mode", project: id, mode },
			id,
			(s) => s.project?.id === id && s.project.mode === mode,
		);
		// A run's permissions are set when it starts: those at work keep their mode until they end.
		const working = listRuns(id).filter((r) => r.state === "running");
		if (working.length)
			console.log(
				`Runs at work keep the mode they started in: ${working.map((r) => r.id).join(", ")}.`,
			);
		return;
	}
	// FR-029: the owner's, here only; never in a repo, never by an agent.
	if (sub === "bypass" && args.length === 2 && ["on", "off"].includes(args[1])) {
		const [id, state] = args;
		const on = state === "on";
		return setting(
			{ kind: "project.bypass", project: id, on },
			id,
			(s) => s.project?.id === id && s.project.bypassApproval === on,
		);
	}
	throw new Error(PROJECT_USAGE);
}

// ── Channels (T065): where pings go. Adding one widens where data goes: a typed confirmation, or a
// card. Their targets hold secrets: shown masked, kept only in config.json (mode 600).
const CHANNEL_USAGE =
	"usage: channel add <ntfy|slack|discord|teams|email> <target> [--urgency now,digest] [--quiet HH:MM-HH:MM] [--digest HH:MM] [--smtp <url>] [--from <address>] | channel list | channel test <id> | channel remove <id>";
async function channelCommand([sub, ...args]) {
	const config = loadConfig();
	if (sub === "list" && !args.length)
		return out(
			config.channels.map(({ smtp, ...c }) => ({
				...c,
				target: maskTarget(c),
				...(smtp ? { smtp: "…" } : {}),
			})),
		);
	if (sub === "add") {
		const { values, positionals } = parseArgs({
			args,
			options: {
				urgency: { type: "string" },
				quiet: { type: "string" },
				digest: { type: "string" },
				smtp: { type: "string" },
				from: { type: "string" },
			},
			allowPositionals: true,
		});
		const [type, target, extra] = positionals;
		if (!type || !target || extra) throw new Error(CHANNEL_USAGE);
		const change = {
			kind: "channel.add",
			type,
			target,
			urgency: values.urgency?.split(","),
			quietHours: values.quiet,
			digestAt: values.digest,
			smtp: values.smtp,
			from: values.from,
		};
		return setting(change, type, () => true);
	}
	if (sub === "remove" && args.length === 1)
		return setting({ kind: "channel.remove", id: args[0] }, args[0], () => true);
	if (sub === "test" && args.length === 1) {
		const channel = config.channels.find((c) => c.id === args[0]);
		if (!channel) throw new Error(`no channel "${args[0]}"`);
		const base = dashboardUrl({ owner: config.owner, port: config.port });
		const test = {
			project: null,
			item: null,
			label: "A test",
			card: { id: "test", q: "A test from Rusuban: this channel works.", to: config.owner.login },
		};
		await sendPing(channel, messageOf([test], { base, owner: config.owner.login }));
		return console.log(`channel ${channel.id}: a test went to ${maskTarget(channel)}.`);
	}
	throw new Error(CHANNEL_USAGE);
}

// The host profile (FR-025): what agents may run on this machine.
async function permissionsCommand([mode, ...rest]) {
	if (!["bypass", "allowlist"].includes(mode) || rest.length)
		throw new Error("usage: permissions <bypass|allowlist>");
	return setting({ kind: "permissions.mode", mode }, mode, () => true);
}

const commands = {
	project: projectCommand,
	permissions: permissionsCommand,
	channel: channelCommand,
	todo() {
		const p = project();
		out(
			todoOf({
				live: p.live(),
				judgment: p.judgment(),
				rules: read(`${p.dir}/rules.json`, {}),
				refused: refusedOf(readJsonl(`${p.dir}/journal.jsonl`)),
			}),
		);
	},
	show([ref]) {
		const p = project();
		const key = parseItem(ref, p.repos);
		const l = p.live();
		out({
			item: key,
			live: [...l.prs, ...l.issues].find((i) => keyOf(i) === key) ?? null,
			judgment: p.judgment().items[key] ?? null,
		});
	},
	judge([file]) {
		if (!file) throw new Error("usage: judge <file.json>");
		const p = project();
		const input = JSON.parse(fs.readFileSync(file, "utf8"));
		const list = Array.isArray(input) ? input : [input];
		withLock(p, () => {
			const judgment = p.judgment();
			const live = p.live();
			for (const j of list) applyJudgment(j, live, judgment, { repos: p.repos, by: p.by });
			write(`${p.dir}/judgment.json`, judgment);
			console.log(
				`${list.length} judgment${list.length > 1 ? "s" : ""} written: ${list.map((j) => inputKey(j, p.repos)).join(", ")}`,
			);
		});
	},
	resolve([ref, ...text]) {
		const p = project();
		const key = parseItem(ref, p.repos);
		withLock(p, () => {
			const judgment = p.judgment();
			const d = closeCard(judgment, key, text.join(" "), readJsonl(`${p.dir}/answers.jsonl`));
			write(`${p.dir}/judgment.json`, judgment);
			console.log(`card of ${key} closed: ${d.state}`);
		});
	},
	// ponytail: the run comes from the environment the agent runs in, so this stops a mistake, not a
	// determined agent; an agent-only token (research R3) is the real wall.
	evidence([ref, state, href]) {
		const p = project();
		const key = parseItem(ref, p.repos);
		const run = process.env.RUSUBAN_RUN ? readRun(process.env.RUSUBAN_RUN) : null;
		if (run?.kind !== "worker")
			throw new Error("a proof is recorded by a worker run, never by the run that judges");
		withLock(p, () => {
			const judgment = p.judgment();
			const e = applyEvidence(judgment, p.live(), key, state, {
				href: href ?? null,
				run: run.id,
				conversation: run.session,
			});
			write(`${p.dir}/judgment.json`, judgment);
			console.log(`evidence of ${key}: ${state} on ${e.head.slice(0, 7)}`);
		});
	},
	worker([sub, name, ref, file]) {
		const p = project();
		if (sub === "start" && name && ref && file) {
			const item = parseItem(ref, p.repos);
			const mission = fs.readFileSync(file, "utf8");
			const r = startWorker({ config: loadConfig(), project: p.id, name, item, mission });
			console.log(`worker ${name} ${r.state} on ${item} (run ${r.id})`);
		} else if (sub === "stop" && name) {
			stopWorker(p.id, name);
			console.log(`worker ${name} stopped`);
		} else if (sub === "list") out(listWorkers(p.id));
		else
			throw new Error(
				"usage: worker start <name> <item> <mission.md> | worker stop <name> | worker list",
			);
	},
	log([kind, ref, text, href]) {
		if (!kind || !ref || !text) throw new Error("usage: log <kind> <item|-> <text> [url]");
		const p = project();
		const item = ref === "-" ? null : parseItem(ref, p.repos);
		// The agent CLI's own journal file, written under the judgment lock like every agent write.
		withLock(p, () => agentLog(p.id, { kind, item, text, href: href ?? null, by: p.by }));
	},
	answers() {
		const p = project();
		out(pendingAnswers(p.judgment(), readJsonl(`${p.dir}/answers.jsonl`)));
	},
	asks() {
		const p = project();
		out(readJsonl(`${p.dir}/asks.jsonl`).slice(read(`${p.dir}/consumed.json`, {}).asks ?? 0));
	},
	// The owner's: the daemon journals how the run ended, as for a task started at its time.
	async task([sub, id, ...rest]) {
		const config = loadConfig();
		if (sub === "list") return out(tasksState(config));
		// Writing a task widens what agents do (FR-092): a typed confirmation, or a card.
		if (sub === "add" && id && !rest.length) {
			const file = path.resolve(id);
			const text = fs.readFileSync(file, "utf8");
			const tid = path.basename(file).replace(/\.md$/, "");
			return setting({ kind: "task.write", id: tid, text }, tid, () => true);
		}
		if (sub === "remove" && id && !rest.length)
			return setting({ kind: "task.remove", id }, id, () => true);
		if (sub !== "run" || !id) throw new Error(TASK_USAGE);
		const t = readTask(id, config);
		if (!t) throw new Error(`no task "${id}": write ${homePath(`tasks/${id}.md`)}`);
		if (t.error) throw new Error(`task ${id}: ${t.error}`);
		const busy = busyRun(id);
		if (busy) throw new Error(`task ${id} already waits or works (run ${busy.id}, ${busy.state})`);
		const r = startTask(t, "manual");
		console.log(`task ${id} ${r.state} (run ${r.id})`);
	},
	// Rusuban's MCP server on stdio, started by Claude Code (contracts/mcp.md).
	async mcp() {
		const { serveMcp } = await import("../src/mcp.mjs");
		await serveMcp();
	},
	async start(args) {
		const { startServer } = await import("../src/server.mjs");
		await startServer({ dry: args.includes("--dry") || process.env.RUSUBAN_DRY === "1" });
	},
	// Internal: the detached process that executes one run (src/agents.mjs).
	async _run([id]) {
		await executeRun(id);
	},
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help") console.log(USAGE);
else if (["--version", "-v", "version"].includes(cmd)) console.log(`rusuban ${version}`);
else if (!Object.hasOwn(commands, cmd)) {
	console.error(`unknown command "${cmd}"\n\n${USAGE}`);
	process.exit(1);
} else {
	try {
		// ponytail: the run comes from the environment, so this stops an agent's mistake; the deny rules
		// stop the command text, and an agent-only token (research R3) is the real wall.
		if (OWNER_COMMANDS.includes(cmd) && process.env.RUSUBAN_RUN)
			throw new Error(`"${cmd}" is the owner's command, never run inside an agent run`);
		await commands[cmd](args);
	} catch (e) {
		console.error(`refused: ${e.message}`);
		process.exit(1);
	}
}
