// The instance home: every state file of one person's Rusuban, each with one writer
// (specs/001-autopilot/data-model.md). JSON is written atomically (temp file + rename), JSONL is
// appended. RUSUBAN_HOME overrides the location, read on every call so tests can point it elsewhere.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

// The journal's one append function, shared by the daemon and the agent CLI.
export const journal = (project, entry) =>
	append(`projects/${project}/journal.jsonl`, { at: new Date().toISOString(), ...entry });

// ── Instance config ───────────────────────────────────────────────────────────────────────────
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SLUG = /^[\w.-]+\/[\w.-]+$/;
const MODES = ["bypass", "allowlist"];

const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

// Checks config.json and fills the defaults that are not policy (port, refresh interval, empty
// lists). The host permission mode has no default: the owner chooses it (FR-025).
export function validateConfig(raw) {
	const c = raw && typeof raw === "object" ? raw : {};
	const errors = [];
	if (!LOGIN.test(c.owner?.login ?? "")) errors.push("owner.login must be a GitHub login");
	if (c.owner?.tailscale !== undefined && typeof c.owner.tailscale !== "string")
		errors.push("owner.tailscale must be a Tailscale login");
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
	const projects = c.projects ?? [];
	if (!Array.isArray(projects)) errors.push("projects must be a list");
	const ids = new Set();
	for (const [i, p] of (Array.isArray(projects) ? projects : []).entries()) {
		const at = `projects[${i}]`;
		if (!PROJECT_ID.test(p?.id ?? ""))
			errors.push(`${at}.id must be lowercase letters, digits and dashes`);
		else if (ids.has(p.id)) errors.push(`${at}.id "${p.id}" is used twice`);
		else ids.add(p.id);
		if (!Array.isArray(p?.repos) || !p.repos.length)
			errors.push(`${at}.repos must list at least one repo`);
		for (const r of Array.isArray(p?.repos) ? p.repos : []) {
			if (!SLUG.test(r?.slug ?? ""))
				errors.push(`${at}: repo slug "${r?.slug}" must be owner/repo`);
			if (r?.checkout != null && typeof r.checkout !== "string")
				errors.push(`${at}: checkout of ${r.slug} must be a path`);
		}
		if (p?.folders !== undefined && !isStrings(p.folders))
			errors.push(`${at}.folders must be a list of paths`);
		const every = p?.refreshSec ?? 90;
		if (!Number.isInteger(every) || every < 30)
			errors.push(`${at}.refreshSec must be an integer of 30 or more`);
	}
	for (const k of ["machines", "channels"])
		if (c[k] !== undefined && !Array.isArray(c[k])) errors.push(`${k} must be a list`);
	if (errors.length) throw new Error(`invalid config.json:\n- ${errors.join("\n- ")}`);
	return {
		owner: { login: c.owner.login, ...(c.owner.tailscale ? { tailscale: c.owner.tailscale } : {}) },
		port,
		permissions: { mode: perm.mode, allow: perm.allow ?? [], deny: perm.deny ?? [] },
		projects: projects.map((p) => ({
			id: p.id,
			title: p.title || p.id,
			repos: p.repos.map((r) => ({ slug: r.slug, checkout: r.checkout ?? null })),
			folders: p.folders ?? [],
			refreshSec: p.refreshSec ?? 90,
		})),
		machines: c.machines ?? [],
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
	write("config.json", valid, { mode: 0o600 });
	return valid;
}
