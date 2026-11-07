import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import {
	append,
	homePath,
	journal,
	loadConfig,
	read,
	readJsonl,
	saveConfig,
	validateConfig,
	write,
} from "../src/home.mjs";

beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-home-"));
});

const config = (over = {}) => ({
	owner: { login: "alice" },
	permissions: { mode: "allowlist" },
	projects: [{ id: "demo", repos: [{ slug: "alice/demo" }] }],
	...over,
});

test("write replaces a file whole and leaves no temp file behind", () => {
	write("projects/demo/live.json", { a: 1, long: "x".repeat(5000) });
	write("projects/demo/live.json", { a: 2 });
	assert.deepEqual(read("projects/demo/live.json"), { a: 2 });
	assert.deepEqual(fs.readdirSync(path.dirname(homePath("projects/demo/live.json"))), [
		"live.json",
	]);
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

test("the journal stamps each entry", () => {
	journal("demo", { kind: "note", text: "hello", by: "server" });
	const [e] = readJsonl("projects/demo/journal.jsonl");
	assert.equal(e.text, "hello");
	assert.ok(Date.parse(e.at) > 0);
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
			{ id: "Demo", repos: [] },
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

test("config.json is saved with mode 600 and loads back", () => {
	saveConfig(config());
	assert.equal(loadConfig().owner.login, "alice");
	if (process.platform !== "win32")
		assert.equal(fs.statSync(homePath("config.json")).mode & 0o777, 0o600);
});

test("a missing config says where it was looked for", () => {
	assert.throws(() => loadConfig(), /no config at/);
});
