// The instance home: every state file of one person's Rusuban, each with one writer
// (specs/001-autopilot/data-model.md). JSON is written atomically (temp file + rename), JSONL is
// appended. RUSUBAN_HOME overrides the location, read on every call so tests can point it elsewhere.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateMachines } from "./machines.mjs";

export const homeDir = () => process.env.RUSUBAN_HOME || path.join(os.homedir(), ".rusuban");
export const homePath = (name) => path.join(homeDir(), name);

export function read(name, fallback) {
	try {
		return JSON.parse(fs.readFileSync(homePath(name), "utf8"));
	} catch {
		return fallback;
	}
}

// Windows refuses to rename over a file another process has open (EPERM), as the daemon has a run's
// status open while it reads it: the rename is tried again for a second before it fails.
const BUSY = ["EPERM", "EACCES", "EBUSY"];
function replace(tmp, target) {
	const until = Date.now() + 1000;
	for (let wait = 10; ; wait = Math.min(wait * 2, 100)) {
		try {
			return fs.renameSync(tmp, target);
		} catch (e) {
			if (!BUSY.includes(e.code) || Date.now() > until) throw e;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
		}
	}
}

export function write(name, value, { mode } = {}) {
	const target = homePath(name);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const tmp = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, { mode });
	replace(tmp, target);
}

function parseJsonl(text) {
	const out = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {} // a line cut short by a crash is skipped, not the whole file
	}
	return out;
}

export function readJsonl(name) {
	let text;
	try {
		text = fs.readFileSync(homePath(name), "utf8");
	} catch {
		return [];
	}
	return parseJsonl(text);
}

// ── What the page reads every two seconds (SC-008) ────────────────────────────────────────────
// A file the page shows is parsed once per change, and its value shared by every reader: frozen, so
// none changes it for the others. Its time and size of last write say whether it changed, once it
// is two seconds old: a file written twice within the clock's step may keep both, so a younger one
// is read again, and parsed only if its text differs.
const freeze = (v) => {
	if (v && typeof v === "object" && !Object.isFrozen(v)) {
		Object.freeze(v);
		for (const x of Object.values(v)) freeze(x);
	}
	return v;
};
const shared = new Map(); // file → { stamp, settled, text, value }
function sharedOf(name, parse, fallback) {
	const file = homePath(name);
	let st;
	try {
		st = fs.statSync(file);
	} catch {
		shared.delete(file);
		return fallback;
	}
	const stamp = `${st.mtimeMs} ${st.size}`;
	const settled = Date.now() - st.mtimeMs > 2000;
	const hit = shared.get(file);
	if (hit?.stamp === stamp && hit.settled) return hit.value;
	let text;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		return fallback;
	}
	const value = hit?.text === text ? hit.value : freeze(parse(text, fallback));
	shared.set(file, { stamp, settled, text, value });
	return value;
}
const parseJson = (text, fallback) => {
	try {
		return JSON.parse(text);
	} catch {
		return fallback;
	}
};
export const readShared = (name, fallback) => sharedOf(name, parseJson, fallback);
// A missing file is the same empty list each time, so what is computed from it stays computed.
const NONE = Object.freeze([]);
export const readJsonlShared = (name) => sharedOf(name, parseJsonl, NONE);

// The value last computed from the same inputs, compared one by one by identity: shared files, and
// whatever else it depends on. One per key and instance home.
const memos = new Map();
export function memo(key, deps, compute) {
	const k = `${homeDir()} ${key}`;
	const m = memos.get(k);
	if (m && m.deps.length === deps.length && m.deps.every((d, i) => Object.is(d, deps[i])))
		return m.value;
	const value = compute();
	memos.set(k, { deps, value });
	return value;
}

export function append(name, entry) {
	const target = homePath(name);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.appendFileSync(target, `${JSON.stringify(entry)}\n`);
}

// The journal is three files, one writer each (principle I): the daemon's, the agent CLI's, which
// writes under the judgment lock, and the settings'. The page shows them as one, in time order.
const stamp = (entry) => ({ at: new Date().toISOString(), ...entry });
export const journal = (project, entry) =>
	append(`projects/${project}/journal.jsonl`, stamp(entry));
export const agentLog = (project, entry) =>
	append(`projects/${project}/agent-log.jsonl`, stamp(entry));
// The settings' own journal (written by src/settings.mjs) joins a project's: its changes, and those of
// the whole instance, such as the host profile.
export function readJournal(project) {
	const parts = [
		readJsonlShared(`projects/${project}/journal.jsonl`),
		readJsonlShared(`projects/${project}/agent-log.jsonl`),
		readJsonlShared("settings.jsonl"),
	];
	return memo(`journal ${project}`, parts, () =>
		Object.freeze(
			[
				...parts[0],
				...parts[1],
				...parts[2].filter((e) => e.project === project || e.project == null),
			].sort((a, b) => String(a.at).localeCompare(String(b.at))),
		),
	);
}

// ── Instance config ───────────────────────────────────────────────────────────────────────────
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const SLUG = /^[\w.-]+\/[\w.-]+$/;
const MODES = ["bypass", "allowlist"];
export const CHANNEL_TYPES = ["ntfy", "slack", "discord", "teams", "email"];
// A Claude Code model id or alias, `claude-opus-5-5` or `opus`; it never starts with a dash.
export const MODEL = /^[A-Za-z0-9][\w.:/@[\]-]{0,99}$/;

const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

export const CONFIG_VERSION = 1; // migrations key off it
const isCount = (v) => Number.isInteger(v) && v > 0;

// Checks config.json and fills the defaults that are not policy (port, refresh interval, empty
// lists). The host permission mode and the limits have no default: the owner's config states them
// (FR-025; `init` writes the limits explicitly). Nor has the runs' model (FR-098): a config without
// one loads, so `rusuban model` can set it, but no run starts until it does.
export function validateConfig(raw) {
	const c = raw && typeof raw === "object" ? raw : {};
	const errors = [];
	if (c.version !== CONFIG_VERSION)
		errors.push(
			c.version > CONFIG_VERSION
				? `version ${c.version} comes from a newer rusuban than this one (${CONFIG_VERSION})`
				: `version must be ${CONFIG_VERSION}`,
		);
	if (!LOGIN.test(c.owner?.login ?? "")) errors.push("owner.login must be a GitHub login");
	// Written by `remote enable` from `tailscale status --json`; it may differ from the GitHub login.
	const tsLogin = c.owner?.tailscaleLogin;
	if (tsLogin !== undefined && (typeof tsLogin !== "string" || !tsLogin.trim()))
		errors.push("owner.tailscaleLogin must be a Tailscale login");
	const port = c.port ?? 8788;
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		errors.push("port must be an integer from 0 to 65535");
	const perm = c.permissions ?? {};
	if (!MODES.includes(perm.mode))
		errors.push(
			'permissions.mode must be "bypass" or "allowlist": there is no default, the owner chooses it',
		);
	for (const k of ["allow", "deny"])
		if (perm[k] !== undefined && !isStrings(perm[k]))
			errors.push(`permissions.${k} must be a list of tool rules`);
	for (const k of ["maxWorkers", "maxRunMinutes"])
		if (!isCount(c.limits?.[k])) errors.push(`limits.${k} must be a positive integer`);
	if (c.model != null && !MODEL.test(c.model))
		errors.push(
			"model must be a Claude Code model id or alias, such as the one `claude --model` takes",
		);
	if (c.workRoot != null && !(typeof c.workRoot === "string" && path.isAbsolute(c.workRoot)))
		errors.push("workRoot must be an absolute path");
	const projects = c.projects ?? [];
	if (!Array.isArray(projects)) errors.push("projects must be a list");
	const ids = new Set();
	// A repo belongs to one project: two would read, judge and merge it each on their own.
	const holders = new Map();
	for (const [i, p] of (Array.isArray(projects) ? projects : []).entries()) {
		const at = `projects[${i}]`;
		if (!PROJECT_ID.test(p?.id ?? ""))
			errors.push(`${at}.id must be lowercase letters, digits and dashes`);
		else if (ids.has(p.id)) errors.push(`${at}.id "${p.id}" is used twice`);
		else ids.add(p.id);
		// Shadow mode is gone (2026-11-09): a project that was in it must not start acting unasked.
		if (p?.mode !== undefined)
			errors.push(
				`${at}.mode is no longer read: every project acts on GitHub as its repos' rules say. Remove "mode" from config.json once this project may act`,
			);
		if (p?.bypassApproval !== undefined && typeof p.bypassApproval !== "boolean")
			errors.push(`${at}.bypassApproval must be true or false`);
		// A project without a repo holds tasks, their runs and conversations: nothing on GitHub.
		if (p?.repos !== undefined && !Array.isArray(p.repos))
			errors.push(`${at}.repos must be a list of repos`);
		for (const r of Array.isArray(p?.repos) ? p.repos : []) {
			if (!SLUG.test(r?.slug ?? ""))
				errors.push(`${at}: repo slug "${r?.slug}" must be owner/repo`);
			else if (holders.has(r.slug.toLowerCase()))
				errors.push(
					`${at}: repo ${r.slug} is already in project "${holders.get(r.slug.toLowerCase())}": a repo belongs to one project`,
				);
			else holders.set(r.slug.toLowerCase(), p.id);
			if (r?.checkout != null && typeof r.checkout !== "string")
				errors.push(`${at}: checkout of ${r.slug} must be a path`);
		}
		if (p?.folders !== undefined && !isStrings(p.folders))
			errors.push(`${at}.folders must be a list of paths`);
		const every = p?.refreshSec ?? 90;
		if (!Number.isInteger(every) || every < 30)
			errors.push(`${at}.refreshSec must be an integer of 30 or more`);
	}
	if (c.channels !== undefined && !Array.isArray(c.channels))
		errors.push("channels must be a list");
	// Machines (FR-060): checked and filled by their own module, their errors told with the others.
	let machines = [];
	try {
		machines = validateMachines(c.machines);
	} catch (e) {
		errors.push(...e.message.split("\n- ").slice(1));
	}
	// Channels (FR-041): where pings go. Their targets hold secrets, which is why the file is mode 600.
	const channelIds = new Set();
	for (const [i, ch] of (Array.isArray(c.channels) ? c.channels : []).entries()) {
		const at = `channels[${i}]`;
		if (!PROJECT_ID.test(ch?.id ?? ""))
			errors.push(`${at}.id must be lowercase letters, digits and dashes`);
		else if (channelIds.has(ch.id)) errors.push(`${at}.id "${ch.id}" is used twice`);
		else channelIds.add(ch.id);
		if (!CHANNEL_TYPES.includes(ch?.type))
			errors.push(`${at}.type must be ${CHANNEL_TYPES.join(", ")}`);
		if (typeof ch?.target !== "string" || !ch.target.trim()) errors.push(`${at}.target is missing`);
		if (!isStrings(ch?.urgency) || !ch.urgency.every((u) => ["now", "digest"].includes(u)))
			errors.push(`${at}.urgency must list now, digest or both`);
		if (ch?.type === "email" && !ch.smtp)
			errors.push(`${at}: an e-mail channel needs its smtp server`);
		if (ch?.token !== undefined && (typeof ch.token !== "string" || !ch.token))
			errors.push(`${at}.token must be the topic's access token`);
	}
	if (errors.length) throw new Error(`invalid config.json:\n- ${errors.join("\n- ")}`);
	return {
		version: CONFIG_VERSION,
		owner: { login: c.owner.login, ...(tsLogin ? { tailscaleLogin: tsLogin } : {}) },
		port,
		permissions: { mode: perm.mode, allow: perm.allow ?? [], deny: perm.deny ?? [] },
		limits: { maxWorkers: c.limits.maxWorkers, maxRunMinutes: c.limits.maxRunMinutes },
		...(c.model ? { model: c.model } : {}),
		...(c.workRoot ? { workRoot: c.workRoot } : {}),
		projects: projects.map((p) => ({
			id: p.id,
			title: p.title || p.id,
			// FR-029: off unless the owner's `project bypass` turned it on.
			bypassApproval: p.bypassApproval === true,
			repos: (p.repos ?? []).map((r) => ({ slug: r.slug, checkout: r.checkout ?? null })),
			folders: p.folders ?? [],
			refreshSec: p.refreshSec ?? 90,
		})),
		machines,
		channels: c.channels ?? [],
	};
}

export function loadConfig() {
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(homePath("config.json"), "utf8"));
	} catch (e) {
		if (e.code === "ENOENT") throw new Error(`no config at ${homePath("config.json")}`);
		throw new Error(`config.json is not valid JSON: ${e.message}`);
	}
	return validateConfig(raw);
}

// config.json holds channel secrets: mode 600.
export function saveConfig(config) {
	const valid = validateConfig(config);
	sealConfig(valid); // first: the daemon may read config.json between the two writes
	write("config.json", valid, { mode: 0o600 });
	return valid;
}

// The seal of what the settings module wrote last (T125). A config.json that does not match it was
// changed outside Rusuban, by hand or by a shell, and the daemon flags it. No seal yet (an instance
// from before T125) means nothing to compare with.
const SEAL = "config.json.seal";
const sealOf = (config) => crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex");
export const sealConfig = (config) => write(SEAL, { sha: sealOf(config) }, { mode: 0o600 });
export const sealMatches = (config) => {
	const seal = read(SEAL, null);
	return !seal || seal.sha === sealOf(config);
};
