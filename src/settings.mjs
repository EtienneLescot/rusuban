// The owner's settings: one implementation, for the owner's commands and the MCP (US9, FR-090). A change
// that widens what agents may do, or where data goes, never applies from a non-interactive context: it
// waits in pending.json as a card the owner allows in the dashboard, unless a person confirmed it in a
// terminal (FR-092). A change that narrows applies at once (FR-093). Each change goes to settings.jsonl
// with its origin (FR-094). Nothing here runs inside an agent run (FR-095). See security.md.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listRuns } from "./agents.mjs";
import {
	append,
	CHANNEL_TYPES,
	CONFIG_VERSION,
	homePath,
	loadConfig,
	PROJECT_ID,
	read,
	readJsonl,
	SLUG,
	saveConfig,
	validateConfig,
	write,
} from "./home.mjs";
import { validateMachines } from "./machines.mjs";
import { lineDiff } from "./rules.mjs";
import { parseTask, waiting } from "./tasks.mjs";

const PENDING = "pending.json";
const LOG = "settings.jsonl";
export const ORIGINS = {
	terminal: "a terminal",
	cli: "the command line, without a terminal",
	mcp: "Claude, through the MCP",
	dashboard: "the dashboard",
};
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const OS_NAME = { windows: "Windows", macos: "macOS", linux: "Linux" };
const textOf = (file) => {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
};
const isArmedNow = () => read("automerge.json", { armed: false }).armed === true;

// Remote access (T076) goes through Tailscale Serve, never Funnel: the dashboard on this machine's
// tailnet name, for the owner's devices. Tests replace `run`.
export const tailscale = {
	run: (args) =>
		execFileSync("tailscale", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 15_000,
			windowsHide: true,
		}),
};
// This machine's tailnet name and the login Tailscale knows its user by, which Serve sends as
// `Tailscale-User-Login` and the dashboard compares (research R7).
function tailnetSelf() {
	let s;
	try {
		s = JSON.parse(tailscale.run(["status", "--json"]));
	} catch {
		throw new Error("Tailscale does not answer: install it and log in, then again");
	}
	const name = s.Self?.DNSName?.replace(/\.$/, "").toLowerCase();
	const login = s.User?.[s.Self?.UserID]?.LoginName;
	if (s.BackendState !== "Running" || !name || !login)
		throw new Error("Tailscale is not logged in on this machine: tailscale up, then again");
	return { name, login };
}
// A channel's target holds its secret (a webhook URL, a topic): only its host, or the address of an
// e-mail channel, is ever shown.
export function maskTarget(channel) {
	if (channel.type === "email") return channel.target;
	try {
		return `${new URL(channel.target).host}/…`;
	} catch {
		return "…";
	}
}
export const MODE_SAYS = {
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

// What a change does: whether it widens, the words of its card when it does, what it says once applied,
// and the change itself. Throws on a change that cannot be made. `same` when nothing would change.
export function planOf(config, change) {
	const find = (id) => {
		const p = config.projects.find((x) => x.id === id);
		if (!p)
			throw new Error(
				`no project "${id}": ${config.projects.map((x) => x.id).join(", ") || "none yet"}`,
			);
		return p;
	};
	const project = (c, id) => c.projects.find((x) => x.id === id);
	switch (change.kind) {
		case "project.add": {
			const { slug, checkout = null, to = null } = change;
			if (!SLUG.test(slug ?? "")) throw new Error(`${slug} is not owner/repo`);
			const holder = config.projects.find((p) =>
				p.repos.some((r) => r.slug.toLowerCase() === slug.toLowerCase()),
			);
			if (holder) throw new Error(`${slug} is already in project ${holder.id}`);
			const dir = checkout ? path.resolve(checkout) : null;
			if (dir && !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory())
				throw new Error(`checkout ${dir} is not a folder`);
			const repo = { slug, checkout: dir };
			if (to) {
				const p = find(to);
				return {
					project: p.id,
					widens: p.mode === "live",
					apply: (c) => project(c, p.id).repos.push(repo),
					said: `${slug} added to project ${p.id} (${p.mode}).`,
					card: {
						q: `Add ${slug} to ${p.id}, a live project?`,
						ctx: `The agents will act on ${slug} as its own rules say, and the server will merge what those rules and the locks allow.`,
						allow: `${slug} joins ${p.id}.`,
						deny: "Nothing changes.",
					},
				};
			}
			// A new project starts in shadow mode: it goes live on its owner's word, never on its own.
			const [owner, name] = slug.split("/");
			const ids = [idOf(name), idOf(`${owner}-${name}`)];
			const id = ids.find((x) => PROJECT_ID.test(x) && !config.projects.some((p) => p.id === x));
			if (!id)
				throw new Error(
					`no free project id for ${slug} (${ids.join(", ")} taken): add it --to a project`,
				);
			return {
				project: id,
				widens: false,
				apply: (c) => c.projects.push({ id, title: name, mode: "shadow", repos: [repo] }),
				said: `project ${id} added, in shadow mode: ${MODE_SAYS.shadow}.`,
			};
		}
		case "project.remove": {
			const p = find(change.project);
			// A run asked for the project would find it gone, or keep writing its files after the remove.
			const busy = listRuns(p.id).filter(waiting);
			if (busy.length)
				throw new Error(
					`project ${p.id} has runs that wait or work: ${busy.map((r) => `${r.id} (${r.state})`).join(", ")}. Stop them in the Agents view, or let them end.`,
				);
			return {
				project: p.id,
				widens: false,
				apply: (c) => {
					c.projects = c.projects.filter((x) => x.id !== p.id);
				},
				said: `project ${p.id} removed.`,
			};
		}
		case "project.mode": {
			const p = find(change.project);
			if (!Object.hasOwn(MODE_SAYS, change.mode)) throw new Error("a mode is live or shadow");
			if (p.mode === change.mode)
				return { project: p.id, same: `project ${p.id} is already ${p.mode}.` };
			const live = change.mode === "live";
			return {
				project: p.id,
				widens: live,
				apply: (c) => {
					project(c, p.id).mode = change.mode;
				},
				said: `project ${p.id} is ${live ? "live" : "in shadow mode"}: ${MODE_SAYS[change.mode]}.`,
				card: {
					q: `Let the agents act on ${p.id} as its rules say?`,
					ctx: "Live, the agents write on GitHub and the server merges what the rules and the locks allow.",
					allow: `${p.id} goes live. Runs at work keep shadow mode until they end.`,
					deny: `${p.id} stays in shadow mode.`,
				},
			};
		}
		case "project.bypass": {
			const p = find(change.project);
			const on = change.on === true;
			if (p.bypassApproval === on)
				return {
					project: p.id,
					same: `project ${p.id}: the approval bypass is already ${on ? "on" : "off"}.`,
				};
			return {
				project: p.id,
				widens: on,
				apply: (c) => {
					project(c, p.id).bypassApproval = on;
				},
				said: on
					? `project ${p.id}: approval bypass on. What the server merges anyway${p.mode === "live" ? "" : " once the project is live"}, with the merge switch armed, it merges with --admin, and only once every check the base branch requires is green on the head.`
					: `project ${p.id}: approval bypass off. The server never merges with --admin.`,
				card: {
					q: `Let the server merge with your bypass on ${p.id}?`,
					ctx: "The bypass skips the required approval only: CI, threads and every other lock still hold.",
					allow:
						"The server merges what passes every lock, without the approval. Each such merge is journaled.",
					deny: "Nothing changes.",
				},
			};
		}
		case "permissions.mode": {
			if (!["bypass", "allowlist"].includes(change.mode))
				throw new Error("the host profile is bypass or allowlist");
			if (config.permissions.mode === change.mode)
				return { project: null, same: `the host profile is already ${change.mode}.` };
			const bypass = change.mode === "bypass";
			return {
				project: null,
				widens: bypass,
				apply: (c) => {
					c.permissions.mode = change.mode;
				},
				said: bypass
					? "host profile: bypass. Agents run any command on this machine but those the built-in deny rules forbid."
					: "host profile: allowlist. Agents run only the commands the allowlist names.",
				card: {
					q: "Let the agents run any command on this machine?",
					ctx: "The host profile goes from allowlist to bypass: the agents get your shell, under the built-in deny rules only.",
					allow: "The agents run every command but those the built-in deny rules forbid.",
					deny: "The allowlist stays.",
				},
			};
		}
		case "task.write": {
			// A task runs claude -p on its schedule: writing one widens what agents do (FR-092), so its
			// card shows the task, or the diff of its file.
			const { id, text } = change;
			if (!TASK_ID.test(id ?? ""))
				throw new Error("a task's id is lowercase letters, digits and dashes");
			const t = parseTask(id, String(text ?? ""), config);
			if (t.error) throw new Error(`task ${id}: ${t.error}`);
			const file = homePath(`tasks/${id}.md`);
			const before = textOf(file);
			if (before === text) return { project: t.project, same: `task ${id} is already so.` };
			const when = t.schedule ? `It runs ${t.schedule}` : "It runs on a click";
			return {
				project: t.project,
				widens: true,
				config: false,
				apply: () => {
					fs.mkdirSync(path.dirname(file), { recursive: true });
					fs.writeFileSync(file, text);
				},
				said: `task ${id} ${before === null ? "added" : "changed"}: ${t.title}. ${when}.`,
				card:
					before === null
						? {
								q: `Add the task “${t.title}” to ${t.project}?`,
								ctx: `${when}, as a Claude session of ${t.project}. Its prompt:\n\n${t.prompt}`,
								allow: `The task is added. ${when}.`,
								deny: "Nothing changes.",
							}
						: {
								q: `Change the task “${t.title}”?`,
								ctx: `Its file changes:\n\n${lineDiff(before, text).join("\n")}`,
								allow: "The task changes from its next run.",
								deny: "The task stays as it is.",
							},
			};
		}
		case "task.remove": {
			const file = homePath(`tasks/${change.id}.md`);
			const text = TASK_ID.test(change.id ?? "") ? textOf(file) : null;
			if (text === null) throw new Error(`no task "${change.id}"`);
			return {
				project: parseTask(change.id, text, config).project,
				widens: false,
				config: false,
				// Kept beside the others, so a prompt someone wrote is never lost.
				apply: () => fs.renameSync(file, `${file}.removed`),
				said: `task ${change.id} removed; its file stays as tasks/${change.id}.md.removed.`,
			};
		}
		case "switch": {
			const armed = change.armed === true;
			if (isArmedNow() === armed)
				return { project: null, same: `merges are already ${armed ? "armed" : "paused"}.` };
			return {
				project: null,
				widens: armed,
				config: false,
				apply: (_, { by }) => write("automerge.json", { armed, at: new Date().toISOString(), by }),
				said: armed ? "Merges armed" : "Merges paused",
				card: {
					q: "Arm automatic merges?",
					ctx: "Armed, the server merges alone what the rules and every lock allow, in every live project.",
					allow: "Merges are armed.",
					deny: "Merges stay paused.",
				},
			};
		}
		case "limits": {
			const next = { ...config.limits };
			for (const k of ["maxWorkers", "maxRunMinutes"])
				if (change[k] !== undefined) {
					if (!Number.isInteger(change[k]) || change[k] < 1)
						throw new Error(`${k} is a positive integer`);
					next[k] = change[k];
				}
			const was = config.limits;
			if (next.maxWorkers === was.maxWorkers && next.maxRunMinutes === was.maxRunMinutes)
				return { project: null, same: "the limits are already so." };
			return {
				project: null,
				widens: next.maxWorkers > was.maxWorkers || next.maxRunMinutes > was.maxRunMinutes,
				apply: (c) => {
					c.limits = next;
				},
				said: `limits: ${next.maxWorkers} workers at most, ${next.maxRunMinutes} minutes a run.`,
				card: {
					q: `Raise the limits to ${next.maxWorkers} workers and ${next.maxRunMinutes} minutes a run?`,
					ctx: `They are ${was.maxWorkers} workers and ${was.maxRunMinutes} minutes now. More agents at once, or longer runs, spend more of your Claude usage.`,
					allow: "The new limits apply to the next runs.",
					deny: "The limits stay.",
				},
			};
		}
		case "channel.add": {
			// A channel sends cards out to its target: it widens where data goes (FR-092).
			const { type, target } = change;
			if (!CHANNEL_TYPES.includes(type))
				throw new Error(`a channel is ${CHANNEL_TYPES.join(", ")}`);
			if (!String(target ?? "").trim()) throw new Error("a channel needs its target");
			const urgency = change.urgency?.length ? change.urgency : ["now", "digest"];
			const ids = [type, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${type}-${n}`)];
			const id = ids.find((x) => !config.channels.some((c) => c.id === x));
			if (!id) throw new Error(`too many ${type} channels`);
			const channel = {
				id,
				type,
				target,
				urgency,
				...(change.quietHours ? { quietHours: change.quietHours } : {}),
				...(change.digestAt ? { digestAt: change.digestAt } : {}),
				...(change.smtp ? { smtp: change.smtp } : {}),
				...(change.from ? { from: change.from } : {}),
				...(change.token ? { token: change.token } : {}),
			};
			return {
				project: null,
				widens: true,
				apply: (c) => c.channels.push(channel),
				said: `channel ${id} added: ${type} to ${maskTarget(channel)}, for ${urgency.join(" and ")} cards.`,
				card: {
					q: `Send your cards to ${type}, ${maskTarget(channel)}?`,
					ctx: `The question, the item and a link of each ${urgency.join(" and ")} card will leave this machine for that target.`,
					allow: `The ${type} channel is added; \`rusuban channel test ${id}\` sends it a test.`,
					deny: "Nothing changes.",
				},
			};
		}
		case "machine.add": {
			// A machine is one more place where agents run code (FR-092). A desktop asks its owner before
			// each lease, in the dashboard: in v1 that is the instance's owner, the one person it knows.
			const m = change.machine ?? {};
			if (m.owner !== undefined && m.owner !== config.owner.login)
				throw new Error(
					`a desktop here is ${config.owner.login}'s: ${m.owner} has no dashboard to say yes in`,
				);
			const machine = validateMachines([...config.machines, m]).at(-1);
			const where = `${OS_NAME[machine.os]}, ${machine.ssh ?? "this host"}`;
			return {
				project: null,
				widens: true,
				apply: (c) => c.machines.push(machine),
				said: `machine ${machine.name} added (${where})${machine.owner ? ": your desktop, each lease asks you first" : ""}.`,
				card: {
					q: `Let the agents work on ${machine.name} (${where})?`,
					ctx: `A run leases it, alone, for ${machine.maxLeaseMin} min at most, and works there as ${machine.agentUser} in ${machine.workspace}.${machine.owner ? " It is your desktop: each lease asks you first." : ""}`,
					allow: `${machine.name} is added; \`rusuban machine probe ${machine.name}\` checks it.`,
					deny: "Nothing changes.",
				},
			};
		}
		case "channel.remove": {
			if (!config.channels.some((c) => c.id === change.id))
				throw new Error(`no channel "${change.id}"`);
			return {
				project: null,
				widens: false,
				apply: (c) => {
					c.channels = c.channels.filter((x) => x.id !== change.id);
				},
				said: `channel ${change.id} removed.`,
			};
		}
		case "owner": {
			if (!LOGIN.test(change.login ?? "")) throw new Error(`${change.login} is not a GitHub login`);
			if (config.owner.login === change.login)
				return { project: null, same: `@${change.login} already owns the instance.` };
			return {
				project: null,
				widens: true,
				apply: (c) => {
					c.owner.login = change.login;
				},
				said: `owner: @${change.login}. Every card goes to them.`,
				card: {
					q: `Make @${change.login} the owner of this instance?`,
					ctx: `Every card goes to the owner, and the dashboard answers as them. It is @${config.owner.login} now.`,
					allow: `@${change.login} owns the instance.`,
					deny: "Nothing changes.",
				},
			};
		}
		case "remote": {
			const on = change.on === true;
			if (!!config.owner.tailscaleLogin === on)
				return { project: null, same: `remote access is already ${on ? "on" : "off"}.` };
			// Off applies at once: without the login, the dashboard refuses every tailnet request, even
			// if Tailscale could not be told to stop forwarding.
			if (!on)
				return {
					project: null,
					widens: false,
					apply: (c) => {
						delete c.owner.tailscaleLogin;
						try {
							tailscale.run(["serve", "--https=443", "off"]);
						} catch {}
					},
					said: "remote access off: the dashboard answers on this machine only.",
				};
			const self = tailnetSelf();
			return {
				project: null,
				widens: true,
				// A card is planned again when allowed: `self` is Tailscale's state at that moment.
				apply: (c) => {
					tailscale.run(["serve", "--bg", "--https=443", `http://127.0.0.1:${c.port}`]);
					c.owner.tailscaleLogin = self.login;
				},
				said: `remote access on: https://${self.name}/, for ${self.login} only.`,
				card: {
					q: `Open the dashboard to your tailnet, at https://${self.name}/?`,
					ctx: `Tailscale Serve forwards it to your devices, never to the internet, and only ${self.login} gets in. Pings then link there, so a phone can answer cards.`,
					allow: "Remote access is on; `rusuban remote disable` turns it off.",
					deny: "The dashboard stays on this machine.",
				},
			};
		}
		default:
			throw new Error(`unknown setting "${change.kind}"`);
	}
}

// One writer at a time, whichever process: the CLI, the MCP server or the daemon. A lock older than
// 10 s belongs to a dead writer and is taken over.
function withLock(fn) {
	const dir = homePath("settings.lock");
	fs.mkdirSync(path.dirname(dir), { recursive: true });
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

const log = (entry) => append(LOG, { at: new Date().toISOString(), kind: "setting", ...entry });
export const pendingRequests = () => read(PENDING, { requests: [] }).requests;
export const settingsLog = () => readJsonl(LOG);

// A change asked by the owner's commands or the MCP. `confirmed`: a person typed its confirmation in a
// terminal. What widens without it waits for the owner's card.
export function changeSetting(change, { origin, by, confirmed = false }) {
	if (process.env.RUSUBAN_RUN)
		throw new Error("the owner's settings are never changed inside an agent run");
	if (!Object.hasOwn(ORIGINS, origin)) throw new Error(`unknown origin "${origin}"`);
	return withLock(() => {
		const config = loadConfig();
		const plan = planOf(config, change);
		if (plan.same) return { state: "unchanged", text: plan.same };
		const base = { project: plan.project, setting: change.kind, origin, by };
		if (plan.widens && !confirmed) {
			const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
			const request = {
				id,
				at: new Date().toISOString(),
				origin,
				by,
				change,
				project: plan.project,
				card: plan.card,
				said: plan.said,
			};
			write(PENDING, { requests: [...pendingRequests(), request] });
			log({
				...base,
				state: "pending",
				request: id,
				text: `Asked from ${ORIGINS[origin]}: ${plan.card.q}`,
			});
			return { state: "pending", id, text: plan.card.q };
		}
		plan.apply(config, { by });
		if (plan.config !== false) saveConfig(config);
		log({ ...base, state: "applied", text: plan.said, ...(plan.widens ? { notify: true } : {}) });
		return { state: "applied", text: plan.said };
	});
}

// `init` (T073): the instance's first config, from the owner's answers in a terminal, so what widens
// in it (the host profile, the switch) is the person's own word. The limits are written out, for the
// owner to see and change; the first project starts in shadow mode, like any.
export const FIRST_LIMITS = { maxWorkers: 3, maxRunMinutes: 150 };
export function initInstance({ owner, mode, armed, port, slug, checkout = null }) {
	return withLock(() => {
		if (fs.existsSync(homePath("config.json")))
			throw new Error(`this instance is set up already: ${homePath("config.json")}`);
		const config = validateConfig({
			version: CONFIG_VERSION,
			owner: { login: owner },
			port,
			permissions: { mode, allow: [], deny: [] },
			limits: { ...FIRST_LIMITS },
			projects: [],
		});
		const plan = planOf(config, { kind: "project.add", slug, checkout });
		plan.apply(config, { by: owner });
		saveConfig(config);
		write("automerge.json", { armed: armed === true, at: new Date().toISOString(), by: owner });
		log({
			project: plan.project,
			setting: "init",
			origin: "terminal",
			by: owner,
			state: "applied",
			text: `Set up by @${owner}: host profile ${mode}, merges ${armed ? "armed" : "paused"}; ${plan.said}`,
			...(mode === "bypass" || armed ? { notify: true } : {}),
		});
		return loadConfig();
	});
}

// The owner's answer to a setting's card, from the dashboard: allowed, it applies on the config as it is
// now; declined, nothing changes. Either way the card goes.
export function confirmRequest(id, { allow, by }) {
	return withLock(() => {
		const request = pendingRequests().find((r) => r.id === id);
		if (!request)
			throw Object.assign(new Error("no such setting waits: it was allowed or declined already"), {
				status: 404,
			});
		write(PENDING, { requests: pendingRequests().filter((r) => r.id !== id) });
		const base = {
			project: request.project,
			setting: request.change.kind,
			origin: request.origin,
			by,
			request: id,
		};
		if (!allow) {
			log({ ...base, state: "declined", text: `Not allowed by @${by}: ${request.card.q}` });
			return { state: "declined" };
		}
		const config = loadConfig();
		let plan;
		try {
			plan = planOf(config, request.change);
		} catch (e) {
			log({ ...base, state: "declined", text: `Could not be applied: ${e.message}` });
			throw Object.assign(e, { status: 409 });
		}
		if (!plan.same) {
			plan.apply(config, { by });
			if (plan.config !== false) saveConfig(config);
		}
		const text = `Allowed by @${by}: ${plan.same ?? plan.said}`;
		log({ ...base, state: "confirmed", text, notify: true });
		return { state: "confirmed", text };
	});
}

// The cards of the settings that wait, for the inbox: a card like the others, with no recommendation and
// no free answer (the validated mockup, T120).
export function settingsCards(config) {
	const clock = (iso) =>
		new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	return pendingRequests().map((r) => ({
		project: r.project,
		projectTitle:
			config.projects.find((p) => p.id === r.project)?.title ?? r.project ?? "This instance",
		item: null,
		type: "setting",
		label: r.card.q,
		kind: null,
		author: null,
		url: null,
		itemOpen: true,
		judgedBy: null,
		evidence: null,
		card: {
			id: `setting:${r.id}`,
			to: config.owner.login,
			urgency: "now",
			q: r.card.q,
			ctx: `Asked from ${ORIGINS[r.origin]}, at ${clock(r.at)}. ${r.card.ctx}`,
			done: [],
			rec: null,
			why: null,
			options: [
				{ id: "allow", label: "Allow it", effect: r.card.allow },
				{
					id: "deny",
					label: "Don't allow it",
					effect: r.origin === "mcp" ? `${r.card.deny} Claude is told.` : r.card.deny,
				},
			],
			createdAt: r.at,
		},
		answer: null,
	}));
}
