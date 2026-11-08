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

export function write(name, value, { mode } = {}) {
	const target = homePath(name);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const tmp = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, { mode });
	fs.renameSync(tmp, target);
}

export function readJsonl(name) {
	let text;
	try {
		text = fs.readFileSync(homePath(name), "utf8");
	} catch {
		return [];
	}
	const out = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {} // a line cut short by a crash is skipped, not the whole file
	}
	return out;
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
export const readJournal = (project) =>
	[
		...readJsonl(`projects/${project}/journal.jsonl`),
		...readJsonl(`projects/${project}/agent-log.jsonl`),
		...readJsonl("settings.jsonl").filter((e) => e.project === project || e.project == null),
	].sort((a, b) => String(a.at).localeCompare(String(b.at)));

// ── Instance config ───────────────────────────────────────────────────────────────────────────
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const SLUG = /^[\w.-]+\/[\w.-]+$/;
const MODES = ["bypass", "allowlist"];
const PROJECT_MODES = ["live", "shadow"];
export const CHANNEL_TYPES = ["ntfy", "slack", "discord", "teams", "email"];

const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

export const CONFIG_VERSION = 1; // migrations key off it
const isCount = (v) => Number.isInteger(v) && v > 0;

// Checks config.json and fills the defaults that are not policy (port, refresh interval, empty
// lists). The host permission mode, the limits and each project's mode have no default: the owner's
// config states them (FR-025, FR-028; `init` writes the limits explicitly).
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
		if (!PROJECT_MODES.includes(p?.mode))
			errors.push(
				`${at}.mode must be "live" or "shadow" (judge only, no GitHub write, no merge): there is no default`,
			);
		if (p?.bypassApproval !== undefined && typeof p.bypassApproval !== "boolean")
			errors.push(`${at}.bypassApproval must be true or false`);
		if (!Array.isArray(p?.repos) || !p.repos.length)
			errors.push(`${at}.repos must list at least one repo`);
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
		projects: projects.map((p) => ({
			id: p.id,
			title: p.title || p.id,
			mode: p.mode,
			// FR-029: off unless the owner's `project bypass` turned it on.
			bypassApproval: p.bypassApproval === true,
			repos: p.repos.map((r) => ({ slug: r.slug, checkout: r.checkout ?? null })),
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
