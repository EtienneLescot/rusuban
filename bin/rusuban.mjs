#!/usr/bin/env node
// The rusuban command. Agent commands run inside a run, which sets RUSUBAN_RUN and RUSUBAN_PROJECT;
// they are the only writers of a project's judgment file and agent log, and each validates against the
// live state and takes a short lock before writing (specs/001-autopilot/contracts/cli.md).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { executeRun, listRuns, OWNER_COMMANDS, readRun } from "../src/agents.mjs";
import {
	agentLog,
	homePath,
	loadConfig,
	PROJECT_ID,
	read,
	readJsonl,
	SLUG,
	saveConfig,
	write,
} from "../src/home.mjs";
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
import { busyRun, listTasks, readTask, startTask, tasksState, waiting } from "../src/tasks.mjs";
import { listWorkers, startWorker, stopWorker } from "../src/workers.mjs";

const { version } = JSON.parse(
	fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const out = (v) => console.log(JSON.stringify(v, null, 1));

const USAGE = `rusuban ${version}

  start [--dry]                 runs the daemon and its dashboard in the foreground
  project add <owner/repo> [--checkout <path>] [--to <project>]
                                adds a repo, to a new project (in shadow mode) or to an existing one
  project list | project remove <id>
                                the projects; one removed, its files kept
  project mode <id> <live|shadow>
                                shadow: agents judge and propose, no GitHub write, no merge
  project bypass <id> <on|off>  merges with --admin what the server merges anyway, once every
                                check the base branch requires is green on the head
  task list | task run <id>     the recurring tasks (tasks/<id>.md in the instance home), or one
                                started now

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

// ── Projects (the owner's) ────────────────────────────────────────────────────────────────────
const PROJECT_USAGE =
	"usage: project add <owner/repo> [--checkout <path>] [--to <project>] | project list | project remove <id> | project mode <id> <live|shadow> | project bypass <id> <on|off>";
const MODE_SAYS = {
	live: "its agents act as its rules say, and the server merges what they allow",
	shadow: "its agents judge and propose, nothing is written on GitHub and nothing merges",
};
// A project's id from a repo's name: lowercase letters, digits and dashes.
const idOf = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/, "")
		.slice(0, 40)
		.replace(/-+$/, "");

// The daemon reads config.json again when it changes. Whether the one running applied the change is
// asked on its own port, so the command says it rather than promise it.
async function daemonApplied(config, id, applied) {
	const at = `127.0.0.1:${config.port}`;
	const until = Date.now() + 8000;
	for (;;) {
		let state;
		try {
			const res = await fetch(`http://${at}/api/state?project=${id}`, {
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

async function projectCommand([sub, ...args]) {
	const config = loadConfig();
	const find = (id) => {
		const p = config.projects.find((x) => x.id === id);
		if (!p)
			throw new Error(
				`no project "${id}": ${config.projects.map((x) => x.id).join(", ") || "none yet"}`,
			);
		return p;
	};
	if (sub === "list" && !args.length) return out(config.projects);
	if (sub === "add") {
		const { values, positionals } = parseArgs({
			args,
			options: { checkout: { type: "string" }, to: { type: "string" } },
			allowPositionals: true,
		});
		const [slug, extra] = positionals;
		if (!slug || extra) throw new Error(PROJECT_USAGE);
		if (!SLUG.test(slug)) throw new Error(`${slug} is not owner/repo`);
		const holder = config.projects.find((p) =>
			p.repos.some((r) => r.slug.toLowerCase() === slug.toLowerCase()),
		);
		if (holder) throw new Error(`${slug} is already in project ${holder.id}`);
		const checkout = values.checkout ? path.resolve(values.checkout) : null;
		if (checkout && !fs.statSync(checkout, { throwIfNoEntry: false })?.isDirectory())
			throw new Error(`checkout ${checkout} is not a folder`);
		const repo = { slug, checkout };
		if (values.to) {
			const p = find(values.to);
			p.repos.push(repo);
			saveConfig(config);
			console.log(`${slug} added to project ${p.id} (${p.mode}).`);
			return console.log(
				await daemonApplied(config, p.id, (s) => s.project?.repos?.includes(slug)),
			);
		}
		// A new project starts in shadow mode: it goes live on its owner's word, never on its own.
		const [owner, name] = slug.split("/");
		const ids = [idOf(name), idOf(`${owner}-${name}`)];
		const id = ids.find((x) => PROJECT_ID.test(x) && !config.projects.some((p) => p.id === x));
		if (!id)
			throw new Error(
				`no free project id for ${slug} (${ids.join(", ")} taken): add it --to a project`,
			);
		config.projects.push({ id, title: name, mode: "shadow", repos: [repo] });
		saveConfig(config);
		console.log(`project ${id} added, in shadow mode: ${MODE_SAYS.shadow}.`);
		console.log(`Make it live with: rusuban project mode ${id} live`);
		return console.log(
			await daemonApplied(config, id, (s) => s.projects?.some((p) => p.id === id)),
		);
	}
	if (sub === "remove" && args.length === 1) {
		const p = find(args[0]);
		// A run asked for the project would find it gone, or keep writing its files after the remove.
		const busy = listRuns(p.id).filter(waiting);
		if (busy.length)
			throw new Error(
				`project ${p.id} has runs that wait or work: ${busy.map((r) => `${r.id} (${r.state})`).join(", ")}. Stop them in the Agents view, or let them end.`,
			);
		config.projects = config.projects.filter((x) => x !== p);
		saveConfig(config);
		// Nothing is deleted: a project added again under the same id finds its state where it was.
		const kept = ["projects", "scratch", "worktrees"]
			.map((d) => homePath(`${d}/${p.id}`))
			.filter((d) => fs.existsSync(d));
		console.log(`project ${p.id} removed.${kept.length ? " Its files stay in:" : ""}`);
		for (const d of kept) console.log(`  ${d}`);
		for (const t of listTasks(config).filter((x) => x.project === p.id))
			console.log(
				`Task ${t.id} names it and will not run: edit or delete ${homePath(`tasks/${t.id}.md`)}`,
			);
		return console.log(
			await daemonApplied(config, p.id, (s) => !s.projects?.some((x) => x.id === p.id)),
		);
	}
	if (sub === "mode" && args.length === 2 && Object.hasOwn(MODE_SAYS, args[1])) {
		const [id, mode] = args;
		const p = find(id);
		if (p.mode === mode) return console.log(`project ${id} is already ${mode}.`);
		p.mode = mode;
		saveConfig(config);
		console.log(
			`project ${id} is ${mode === "live" ? "live" : "in shadow mode"}: ${MODE_SAYS[mode]}.`,
		);
		// A run's permissions are set when it starts: those at work keep their mode until they end.
		const working = listRuns(id).filter((r) => r.state === "running");
		if (working.length)
			console.log(
				`Runs at work keep the mode they started in: ${working.map((r) => r.id).join(", ")}.`,
			);
		return console.log(
			await daemonApplied(config, id, (s) => s.project?.id === id && s.project.mode === mode),
		);
	}
	// FR-029: the owner's, here only; never in a repo, never by an agent.
	if (sub === "bypass" && args.length === 2 && ["on", "off"].includes(args[1])) {
		const [id, state] = args;
		const p = find(id);
		const on = state === "on";
		if (p.bypassApproval === on)
			return console.log(`project ${id}: the approval bypass is already ${state}.`);
		p.bypassApproval = on;
		saveConfig(config);
		console.log(
			on
				? `project ${id}: approval bypass on. What the server merges anyway${p.mode === "live" ? "" : " once the project is live"}, with the merge switch armed, it merges with --admin, and only once every check the base branch requires is green on the head.`
				: `project ${id}: approval bypass off. The server never merges with --admin.`,
		);
		return console.log(
			await daemonApplied(
				config,
				id,
				(s) => s.project?.id === id && s.project.bypassApproval === on,
			),
		);
	}
	throw new Error(PROJECT_USAGE);
}

const commands = {
	project: projectCommand,
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
	task([sub, id]) {
		const config = loadConfig();
		if (sub === "list") return out(tasksState(config));
		if (sub !== "run" || !id) throw new Error("usage: task list | task run <id>");
		const t = readTask(id, config);
		if (!t) throw new Error(`no task "${id}": write ${homePath(`tasks/${id}.md`)}`);
		if (t.error) throw new Error(`task ${id}: ${t.error}`);
		const busy = busyRun(id);
		if (busy) throw new Error(`task ${id} already waits or works (run ${busy.id}, ${busy.state})`);
		const r = startTask(t, "manual");
		console.log(`task ${id} ${r.state} (run ${r.id})`);
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
