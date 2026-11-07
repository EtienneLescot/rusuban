#!/usr/bin/env node
// The rusuban command. Agent commands run inside a run, which sets RUSUBAN_RUN and RUSUBAN_PROJECT;
// they are the only writers of a project's judgment file, and each validates against the live state
// and takes a short lock before writing (specs/001-autopilot/contracts/cli.md).
import fs from "node:fs";
import { executeRun } from "../src/agents.mjs";
import { homePath, journal, loadConfig, read, readJsonl, write } from "../src/home.mjs";
import {
	actingRepos,
	applyEvidence,
	applyJudgment,
	closeCard,
	flatten,
	inputKey,
	keyOf,
	parseItem,
	pendingAnswers,
	todoOf,
} from "../src/model.mjs";

const { version } = JSON.parse(
	fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const out = (v) => console.log(JSON.stringify(v, null, 1));

const USAGE = `rusuban ${version}

  start [--dry]                 runs the daemon and its dashboard in the foreground

Agent commands, inside a run (an item is owner/repo#n, or #n when the project has one repo):
  todo                          what the agents must do, each with its reason
  show <item>                   live state and judgment of an item
  judge <file.json>             writes judgments: one object or a list
  resolve <item> <text>         closes an item's open card, saying what happened
  evidence <item> <todo|running|ok|fail> [url]
  log <kind> <item|-> <text> [url]
  answers | asks                answers and requests not handled yet`;

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

const commands = {
	todo() {
		const p = project();
		out(
			todoOf({
				live: p.live(),
				judgment: p.judgment(),
				acting: actingRepos(read(`${p.dir}/rules.json`, {})),
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
	evidence([ref, state, href]) {
		const p = project();
		const key = parseItem(ref, p.repos);
		withLock(p, () => {
			const judgment = p.judgment();
			const e = applyEvidence(judgment, p.live(), key, state, href ?? null);
			write(`${p.dir}/judgment.json`, judgment);
			console.log(`evidence of ${key}: ${state} on ${e.head.slice(0, 7)}`);
		});
	},
	log([kind, ref, text, href]) {
		if (!kind || !ref || !text) throw new Error("usage: log <kind> <item|-> <text> [url]");
		const p = project();
		journal(p.id, {
			kind,
			item: ref === "-" ? null : parseItem(ref, p.repos),
			text,
			href: href ?? null,
			by: p.by,
		});
	},
	answers() {
		const p = project();
		out(pendingAnswers(p.judgment(), readJsonl(`${p.dir}/answers.jsonl`)));
	},
	asks() {
		const p = project();
		out(readJsonl(`${p.dir}/asks.jsonl`).slice(read(`${p.dir}/consumed.json`, {}).asks ?? 0));
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
		await commands[cmd](args);
	} catch (e) {
		console.error(`refused: ${e.message}`);
		process.exit(1);
	}
}
