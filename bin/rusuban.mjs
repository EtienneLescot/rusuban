#!/usr/bin/env node
// The rusuban command. Agent commands run inside a run, which sets RUSUBAN_RUN and RUSUBAN_PROJECT;
// they are the only writers of a project's judgment file and agent log, and each validates against the
// live state and takes a short lock before writing (specs/001-autopilot/contracts/cli.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { executeRun, listRuns, OWNER_COMMANDS, readRun } from "../src/agents.mjs";
import { agentLog, homePath, loadConfig, read, readJsonl, SLUG, write } from "../src/home.mjs";
import {
	answerOf,
	askDesktop,
	checkMachine,
	detectOs,
	enrollMachine,
	probeMachines,
	releaseLease,
	validateMachines,
	waitLease,
} from "../src/machines.mjs";
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
import {
	inNpxCache,
	installService,
	openUrl,
	dashboardUrl as serviceUrl,
	uninstallService,
} from "../src/service.mjs";
import {
	changeSetting,
	FIRST_LIMITS,
	initInstance,
	MODE_SAYS,
	maskTarget,
	planOf,
} from "../src/settings.mjs";
import { busyRun, listTasks, readTask, startTask, tasksState } from "../src/tasks.mjs";
import { listWorkers, startWorker, stopWorker } from "../src/workers.mjs";

const { version } = JSON.parse(
	fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const out = (v) => console.log(JSON.stringify(v, null, 1));
// A command init needs, and what to do when it does not answer.
const asked = (cmd, args, fix) => {
	try {
		return execFileSync(cmd, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		}).trim();
	} catch {
		throw new Error(`${fix}, then rusuban init again`);
	}
};
// The first port from `from` nothing listens on: the dashboard's, written in config.json.
async function freePort(from) {
	for (let port = from; port < from + 20; port++) {
		const free = await new Promise((resolve) => {
			const s = net.createServer();
			s.once("error", () => resolve(false));
			s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
		});
		if (free) return port;
	}
	throw new Error(`no free port from ${from} to ${from + 19}`);
}
// Whether release a is after release b, by their major, minor and patch numbers.
const newer = (a, b) => {
	const [x, y] = [a, b].map((v) => String(v).split(/[.+-]/).slice(0, 3).map(Number));
	const i = x.findIndex((n, k) => n !== y[k]);
	return i >= 0 && x[i] > y[i];
};
const minutes = (ms) => {
	const m = Math.max(0, Math.round(ms / 60e3));
	return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

// The service's daemon has no console to read: what it says goes to a log file too, the previous one
// kept as <file>.1 once past 5 MB at a start. A crash is written there before the process ends.
// ponytail: rotated at start only; a daemon that runs for months grows its log until it restarts.
function logTo(file) {
	try {
		if (fs.statSync(file).size > 5e6) fs.renameSync(file, `${file}.1`);
	} catch {}
	const log = fs.createWriteStream(file, { flags: "a" });
	for (const stream of [process.stdout, process.stderr]) {
		const write = stream.write.bind(stream);
		stream.write = (chunk, ...rest) => {
			log.write(chunk);
			return write(chunk, ...rest);
		};
	}
	process.on("uncaughtException", (e) => {
		console.error(new Date().toISOString(), "crashed:", e?.stack ?? e);
		log.end(() => process.exit(1));
	});
}

const USAGE = `rusuban ${version}

  init                          sets this machine up: asks what has no default, adds a first repo,
                                installs the service, registers the MCP server, opens the dashboard
  start [--dry] [--log]         runs the daemon and its dashboard in the foreground; --log also
                                writes what it says to daemon.log (what the service runs)
  status                        the dashboard's URL, the daemon's uptime, projects, agents at work
  open                          opens the dashboard
  service install | service uninstall
                                starts the daemon at logon and again when it stops, with a menu
                                shortcut to the dashboard; or removes both
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
  remote enable | remote disable
                                the dashboard on your tailnet, through Tailscale Serve, so a phone
                                can answer cards; or this machine only
  machine add <alias> [--os <os>] [--caps a,b] [--workspace <path>] [--owner <login>]
          | machine list | machine probe [<machine>] | machine doctor <machine>
                                the test machines agents lease, reached over SSH as their own
                                account; add checks one and makes its bare mirrors (it widens)
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
  worker start <name> <item> <mission.md> | worker stop <name> | worker list
  lease <machine> | --os <os> [--caps a,b]  [--repo <owner/repo>] [--wait 20m] --reason <text>
                                takes a test machine for the run, alone, until release or the end
                                of the run; --repo makes the run a worktree there
  release <machine>             gives it back`;

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
	"usage: channel add <ntfy|slack|discord|teams|email> <target> [--urgency now,digest] [--quiet HH:MM-HH:MM] [--digest HH:MM] [--smtp <url>] [--from <address>] [--token <token>] | channel list | channel test <id> | channel remove <id>";
async function channelCommand([sub, ...args]) {
	const config = loadConfig();
	if (sub === "list" && !args.length)
		return out(
			config.channels.map(({ smtp, token, ...c }) => ({
				...c,
				target: maskTarget(c),
				...(smtp ? { smtp: "…" } : {}),
				...(token ? { token: "…" } : {}),
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
				token: { type: "string" },
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
			token: values.token,
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

// `--wait 20m`: a number of minutes, or of seconds, minutes or hours with s, m or h.
const UNIT_MS = { s: 1e3, m: 60e3, min: 60e3, h: 3600e3 };
function durationMs(text) {
	const m = /^(\d+)\s*(s|m|min|h)?$/.exec(String(text).trim());
	if (!m) throw new Error(`${text} is not a duration: 90s, 20m or 1h`);
	return Number(m[1]) * UNIT_MS[m[2] ?? "m"];
}
const checked = (checks) => {
	for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.check}: ${c.said}`);
	return checks.every((c) => c.ok);
};

const MACHINE_USAGE =
	"usage: machine add <alias> [--os <os>] [--caps a,b] [--workspace <path>] [--owner <login>] | machine list | machine probe [<machine>] | machine doctor <machine>";
// The owner's test machines (T066, T109). Adding one widens where agents run: it is checked over SSH
// first, then confirmed like any widening setting.
async function machineCommand([sub, ...args]) {
	const config = loadConfig();
	const named = (name) => {
		const m = config.machines.find((x) => x.name === name);
		if (!m) throw new Error(`no machine named ${name}: rusuban machine list`);
		return m;
	};
	if (sub === "list" && !args.length) return out(config.machines);
	if (sub === "probe" && args.length <= 1) {
		const machines = args.length ? [named(args[0])] : config.machines;
		return out(await probeMachines({ ...config, machines }));
	}
	if (sub === "doctor" && args.length === 1) {
		if (!checked(await checkMachine(named(args[0])))) process.exitCode = 1;
		return;
	}
	if (sub !== "add") throw new Error(MACHINE_USAGE);
	const { values, positionals } = parseArgs({
		args,
		options: {
			os: { type: "string" },
			caps: { type: "string" },
			workspace: { type: "string" },
			owner: { type: "string" },
		},
		allowPositionals: true,
	});
	const [alias, extra] = positionals;
	if (!alias || extra) throw new Error(MACHINE_USAGE);
	const machine = validateMachines([
		...config.machines,
		{
			name: alias
				.toLowerCase()
				.replace(/[^a-z0-9-]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 40),
			os: values.os ?? (await detectOs({ ssh: alias })),
			ssh: alias,
			caps: values.caps?.split(",").map((c) => c.trim()) ?? [],
			...(values.workspace ? { workspace: values.workspace } : {}),
			...(values.owner ? { owner: values.owner } : {}),
		},
	]).at(-1);
	const { checks } = await enrollMachine(machine, config);
	if (!checked(checks))
		throw new Error(`${machine.name} is not added: fix what failed, then again`);
	return setting({ kind: "machine.add", machine }, machine.name, () => true);
}

const LEASE_USAGE =
	"usage: lease <machine> | --os <os> [--caps a,b]  [--repo <owner/repo>] [--wait 20m] --reason <text>";
const commands = {
	project: projectCommand,
	machine: machineCommand,
	permissions: permissionsCommand,
	channel: channelCommand,
	// Remote access (T076): Tailscale Serve, never Funnel. On widens where the dashboard answers.
	remote([sub, ...rest]) {
		if (rest.length || !["enable", "disable"].includes(sub))
			throw new Error("usage: remote enable | remote disable");
		return setting({ kind: "remote", on: sub === "enable" }, "remote", () => true);
	},
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
	// T068: a test machine for the run, held on the machine itself while the run lives. A person's
	// desktop waits for that person's yes in the dashboard (T070); a no ends the wait.
	async lease(args) {
		const { values, positionals } = parseArgs({
			args,
			options: {
				os: { type: "string" },
				caps: { type: "string" },
				repo: { type: "string" },
				wait: { type: "string" },
				reason: { type: "string" },
			},
			allowPositionals: true,
		});
		const run = process.env.RUSUBAN_RUN;
		if (!run) throw new Error("lease is a run's command: RUSUBAN_RUN is not set");
		const [machine, extra] = positionals;
		if (extra || !machine === !values.os) throw new Error(LEASE_USAGE);
		const p = project();
		const config = loadConfig();
		const request = {
			run,
			project: p.id,
			reason: values.reason,
			...(machine
				? { machine }
				: { os: values.os, caps: values.caps?.split(",").map((c) => c.trim()) ?? [] }),
			...(values.repo ? { slug: values.repo } : {}),
			waitMs: values.wait ? durationMs(values.wait) : 0,
		};
		let asks = []; // the desktops asked for, once only desktops fit
		let said = "";
		const r = await waitLease(config, request, {
			approved: (name, id) => answerOf(id, name)?.yes === true,
			onState: (st) => {
				if (st.state === "requested") {
					asks = st.asks;
					askDesktop({ ...st, project: p.id }).catch(() => {});
				}
				const line =
					st.state === "queued"
						? `queued: number ${st.position} for ${st.machines.join(", ")}`
						: st.state === "requested"
							? `waiting for ${[...new Set(st.asks.map((a) => a.owner))].join(", ")} to say yes in the dashboard`
							: "";
				if (!line || line === said) return;
				said = line;
				console.log(line);
			},
			pause: async (ms) => {
				if (asks.length && asks.every((a) => answerOf(run, a.machine)?.yes === false))
					throw new Error("the owner said no: no machine for this run");
				await new Promise((resolve) => setTimeout(resolve, ms));
			},
		});
		if (r.state !== "held")
			throw new Error(`no machine after ${values.wait ?? "one try"}: the run left the queue`);
		const m = config.machines.find((x) => x.name === r.machine);
		console.log(
			`leased ${m.name} until ${new Date(r.lease.expires).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}: ssh -l ${m.agentUser} ${m.ssh ?? "(this host)"}`,
		);
		if (r.worktree) console.log(`worktree: ${r.worktree}`);
	},
	// The run's own lease; from the owner's terminal (no run), whoever holds the machine.
	async release([name, ...rest]) {
		if (!name || rest.length) throw new Error("usage: release <machine>");
		const run = process.env.RUSUBAN_RUN ?? null;
		const done = await releaseLease(loadConfig(), name, run);
		console.log(done ? `released ${name}` : `${name}: no lease of ${run ?? "anyone"} to end`);
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
		if (args.includes("--log")) logTo(homePath("daemon.log"));
		const { startServer } = await import("../src/server.mjs");
		await startServer({ dry: args.includes("--dry") || process.env.RUSUBAN_DRY === "1" });
	},
	async status() {
		const config = loadConfig();
		const url = dashboardUrl({ owner: config.owner, port: config.port });
		const state = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(3000) })
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		const log = homePath("daemon.log");
		if (!state) {
			console.log(`rusuban is not answering on ${url}/: see ${log}`);
			process.exitCode = 1;
			return;
		}
		const { tailnetName } = await import("../src/server.mjs");
		const tailnet = config.owner.tailscaleLogin ? await tailnetName() : null;
		// T113: a newer release on npm, said once here; nothing is installed without the owner.
		const registry = process.env.RUSUBAN_REGISTRY ?? "https://registry.npmjs.org";
		const latest = await fetch(`${registry}/rusuban/latest`, { signal: AbortSignal.timeout(3000) })
			.then((r) => (r.ok ? r.json() : null))
			.then((p) => p?.version ?? null)
			.catch(() => null);
		const ago = (at) => minutes(Date.now() - Date.parse(at));
		const runs = listRuns().filter((r) => r.state === "running");
		const projects = config.projects.map(
			(p) => `${p.id} (${p.mode}${p.bypassApproval ? ", approval bypass on" : ""})`,
		);
		console.log(
			[
				`rusuban ${state.version}${state.dry ? " (dry)" : ""}, up ${ago(state.startedAt)}, on ${url}/`,
				...(tailnet ? [`from your tailnet: https://${tailnet}/`] : []),
				...(latest && newer(latest, version)
					? [`rusuban ${latest} is out: npm i -g rusuban, then rusuban service install to restart`]
					: []),
				`merges ${state.armed ? "armed" : "paused"}; projects: ${projects.join(", ") || "none"}`,
				`agents at work: ${runs.map((r) => `${r.title ?? r.kind} in ${r.project}, ${ago(r.startedAt)}`).join("; ") || "none"}`,
				`log: ${log}`,
			].join("\n"),
		);
	},
	open() {
		const config = loadConfig();
		const url = serviceUrl(config.port);
		openUrl(url);
		console.log(url);
	},
	// The first setup (T073, T124): what has no default is asked, then the service, Rusuban's MCP server
	// for Claude, and the dashboard.
	async init(args) {
		if (args.length) throw new Error("usage: init");
		const bin = fileURLToPath(import.meta.url);
		if (inNpxCache(bin))
			throw new Error(
				"npx runs rusuban from a cache npm empties: npm i -g rusuban, then rusuban init",
			);
		if (!(process.stdin.isTTY && process.stdout.isTTY))
			throw new Error("init asks you questions: run it in a terminal");
		if (fs.existsSync(homePath("config.json")))
			throw new Error(
				`this instance is set up already (${homePath("config.json")}): rusuban status`,
			);
		const owner = asked(
			"gh",
			["api", "user", "--jq", ".login"],
			"gh is not logged in: gh auth login",
		);
		const auth = asked("claude", ["auth", "status"], "Claude Code does not answer: install it");
		if (!JSON.parse(auth).loggedIn)
			throw new Error("Claude Code is not logged in: claude auth login");
		console.log(`Owner: @${owner}, from gh.`);
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		const ask = async (q, ok) => {
			for (;;) {
				const a = (await rl.question(q)).trim();
				if (ok(a)) return a;
			}
		};
		let answers;
		try {
			answers = {
				mode: await ask(
					"What may agents run on this machine? bypass (anything the deny rules allow) or allowlist (what you list): ",
					(a) => ["bypass", "allowlist"].includes(a),
				),
				armed:
					(await ask(
						"Arm automatic merges? The server then merges alone what a live project's rules and locks allow. yes or no: ",
						(a) => ["yes", "no"].includes(a),
					)) === "yes",
				slug: await ask(
					"A first repo, owner/repo (in shadow mode: nothing is written on GitHub): ",
					(a) => SLUG.test(a),
				),
				checkout:
					(await ask(
						"Its checkout on this machine, if you have one (Enter for none): ",
						(a) => !a || fs.statSync(path.resolve(a), { throwIfNoEntry: false })?.isDirectory(),
					)) || null,
			};
		} finally {
			rl.close();
		}
		const config = initInstance({ owner, port: await freePort(8788), ...answers });
		console.log(
			`Limits: ${FIRST_LIMITS.maxWorkers} agents at once, ${FIRST_LIMITS.maxRunMinutes} minutes a run, in ${homePath("config.json")}.`,
		);
		const { service } = installService({ port: config.port });
		console.log(`Service: ${service}, started.`);
		// T124: Claude can set Rusuban up through its MCP server, what widens waiting for the owner.
		try {
			execFileSync("claude", ["mcp", "remove", "--scope", "user", "rusuban"], { stdio: "ignore" });
		} catch {}
		execFileSync(
			"claude",
			["mcp", "add", "--scope", "user", "rusuban", "--", process.execPath, bin, "mcp"],
			{ stdio: "ignore", windowsHide: true },
		);
		console.log("MCP server: rusuban, for Claude Code.");
		const url = serviceUrl(config.port);
		console.log(`Rusuban runs: ${url}`);
		openUrl(url);
	},
	service([sub, ...rest]) {
		if (rest.length || !["install", "uninstall"].includes(sub))
			throw new Error("usage: service install | service uninstall");
		if (sub === "uninstall") {
			const r = uninstallService();
			return console.log(`service removed: ${r.service}, and the shortcut ${r.shortcut}.`);
		}
		const config = loadConfig();
		const r = installService({ port: config.port });
		console.log(
			`service installed: ${r.service}; the shortcut ${r.shortcut} opens ${serviceUrl(config.port)}`,
		);
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
