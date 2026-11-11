import "./tmp-root.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import {
	agentLog,
	append,
	homePath,
	journal,
	loadConfig,
	read,
	readJournal,
	readJsonl,
	saveConfig,
	validateConfig,
	write,
} from "../src/home.mjs";

beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-home-"));
});

const config = (over = {}) => ({
	version: 1,
	owner: { login: "alice" },
	permissions: { mode: "allowlist" },
	limits: { maxWorkers: 3, maxRunMinutes: 150 },
	projects: [{ id: "demo", repos: [{ slug: "alice/demo" }] }],
	...over,
});

test("a project has no mode: one still named in shadow mode is refused, never made to act unasked", () => {
	const project = (mode) => config({ projects: [{ id: "demo", mode, repos: [{ slug: "a/b" }] }] });
	for (const mode of ["shadow", "live"])
		assert.throws(() => validateConfig(project(mode)), /projects\[0\]\.mode is no longer read/);
	assert.equal(Object.hasOwn(validateConfig(config()).projects[0], "mode"), false);
});

test("the owner's Tailscale login is optional, and kept apart from the GitHub login", () => {
	assert.deepEqual(validateConfig(config()).owner, { login: "alice" });
	const owner = { login: "alice", tailscaleLogin: "alice@example.com" };
	assert.deepEqual(validateConfig(config({ owner })).owner, owner);
	assert.throws(
		() => validateConfig(config({ owner: { login: "alice", tailscaleLogin: " " } })),
		/owner.tailscaleLogin/,
	);
});

test("the config states its version, and a newer one is refused", () => {
	assert.throws(() => validateConfig(config({ version: undefined })), /version must be 1/);
	assert.throws(() => validateConfig(config({ version: 2 })), /newer rusuban/);
	assert.equal(validateConfig(config()).version, 1);
});

test("the limits are stated in the config, not defaulted", () => {
	assert.throws(
		() => validateConfig(config({ limits: undefined })),
		/limits.maxWorkers.*\n.*limits.maxRunMinutes/,
	);
	assert.throws(
		() => validateConfig(config({ limits: { maxWorkers: 0, maxRunMinutes: 150 } })),
		/limits.maxWorkers/,
	);
	assert.deepEqual(validateConfig(config()).limits, { maxWorkers: 3, maxRunMinutes: 150 });
});

test("write replaces a file whole and leaves no temp file behind", () => {
	write("projects/demo/live.json", { a: 1, long: "x".repeat(5000) });
	write("projects/demo/live.json", { a: 2 });
	assert.deepEqual(read("projects/demo/live.json"), { a: 2 });
	assert.deepEqual(fs.readdirSync(path.dirname(homePath("projects/demo/live.json"))), [
		"live.json",
	]);
});

test("write tries again for a second while Windows refuses the rename, then fails; other errors fail at once", (t) => {
	const refuse = (code) =>
		t.mock.method(fs, "renameSync", () => {
			throw Object.assign(new Error(`${code}: rename`), { code });
		});
	const busy = refuse("EPERM");
	const start = Date.now();
	assert.throws(() => write("a.json", {}), /EPERM/);
	assert.ok(Date.now() - start >= 1000, "tried for a second");
	assert.ok(busy.mock.callCount() > 3);
	busy.mock.restore();
	const gone = refuse("ENOENT");
	assert.throws(() => write("a.json", {}), /ENOENT/);
	assert.equal(gone.mock.callCount(), 1);
});

test("missing files read as the fallback", () => {
	assert.equal(read("nope.json", null), null);
	assert.deepEqual(read("nope.json", { items: {} }), { items: {} });
	assert.deepEqual(readJsonl("nope.jsonl"), []);
});

test("append adds lines, and a line cut by a crash is skipped alone", () => {
	append("j.jsonl", { n: 1 });
	fs.appendFileSync(homePath("j.jsonl"), '{"n": 2, "cut');
	fs.appendFileSync(homePath("j.jsonl"), "\n");
	append("j.jsonl", { n: 3 });
	assert.deepEqual(
		readJsonl("j.jsonl").map((e) => e.n),
		[1, 3],
	);
});

test("the journal is two files, one per writer, read back as one in time order", () => {
	journal("demo", { kind: "note", text: "daemon", by: "server", at: "2026-11-07T10:00:02Z" });
	agentLog("demo", { kind: "note", text: "agent", by: "agent", at: "2026-11-07T10:00:01Z" });
	journal("demo", { kind: "note", text: "stamped", by: "server" });
	assert.deepEqual(
		readJsonl("projects/demo/journal.jsonl").map((e) => e.text),
		["daemon", "stamped"],
	);
	assert.deepEqual(
		readJsonl("projects/demo/agent-log.jsonl").map((e) => e.text),
		["agent"],
	);
	assert.deepEqual(
		readJournal("demo").map((e) => e.text),
		["agent", "daemon", "stamped"],
	);
	assert.ok(Date.parse(readJournal("demo")[2].at) > 0);
});

test("the host permission mode has no default", () => {
	assert.throws(() => validateConfig(config({ permissions: {} })), /no default/);
	assert.equal(validateConfig(config()).permissions.mode, "allowlist");
});

test("config defaults fill what is not policy, and mistakes are all reported", () => {
	const c = validateConfig(config());
	assert.deepEqual([c.port, c.projects[0].refreshSec, c.projects[0].title], [8788, 90, "demo"]);
	assert.deepEqual(c.permissions.deny, []);
	const bad = config({
		owner: {},
		projects: [
			{ id: "Demo", repos: "o/r" },
			{ id: "x", repos: [{ slug: "nope" }], refreshSec: 5 },
		],
	});
	assert.throws(
		() => validateConfig(bad),
		(e) =>
			["owner.login", "projects[0].id", "projects[0].repos", "owner/repo", "refreshSec"].every(
				(s) => e.message.includes(s),
			),
	);
});

test("a project may have no repo: its tasks, runs and conversations, nothing on GitHub", () => {
	const repoless = (p) => validateConfig(config({ projects: [p] })).projects[0];
	assert.deepEqual(repoless({ id: "publications", title: "Publications" }).repos, []);
	assert.deepEqual(repoless({ id: "publications", repos: [] }).repos, []);
});

test("config.json is saved with mode 600 and loads back", () => {
	saveConfig(config());
	assert.equal(loadConfig().owner.login, "alice");
	if (process.platform !== "win32")
		assert.equal(fs.statSync(homePath("config.json")).mode & 0o777, 0o600);
});

test("a missing config says where it was looked for", () => {
	assert.throws(() => loadConfig(), /no config at/);
});
