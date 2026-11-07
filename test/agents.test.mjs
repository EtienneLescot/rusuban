import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	builtInDeny,
	editRule,
	executeRun,
	holder,
	kickQueues,
	listRuns,
	permissionArgs,
	queued,
	readRun,
	requestRun,
	runner,
	SHADOW_DENY,
} from "../src/agents.mjs";
import { homePath, write } from "../src/home.mjs";

const FAKE = [
	process.execPath,
	fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url)),
];
const launched = [];
runner.launch = (id) => launched.push(id);

beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-agents-"));
	launched.length = 0;
	delete process.env.FAKE_CLAUDE_MS;
});

const denied = (args) => args.slice(args.indexOf("--disallowedTools") + 1);
const WIN = process.platform === "win32";
const HOME = WIN ? "C:\\Users\\a\\.rusuban" : "/home/a/.rusuban";
const HOME_RULE = WIN ? "Edit(//c/Users/a/.rusuban/**)" : "Edit(//home/a/.rusuban/**)";

test("the built-in deny rules come with both profiles, and the owner's deny rules only add", () => {
	const context = { home: HOME, defaultBranches: ["main", "main", "trunk"] };
	const builtIn = builtInDeny(context);
	for (const rule of [
		"Bash(gh pr merge*)",
		"Bash(gh api*merge*)",
		"Bash(git push* main)",
		"Bash(git push*:trunk)",
		HOME_RULE,
	])
		assert.ok(builtIn.includes(rule), rule);
	assert.equal(builtIn.filter((r) => r === "Bash(git push* main)").length, 1);

	const bypass = permissionArgs({ mode: "bypass", allow: [], deny: ["Bash(curl*)"] }, context);
	assert.equal(bypass[0], "--dangerously-skip-permissions");
	assert.deepEqual(denied(bypass), [...builtIn, "Bash(curl*)"]);

	const allowlist = permissionArgs(
		{ mode: "allowlist", allow: ["Bash(npm test*)", "Read"], deny: [] },
		context,
	);
	assert.deepEqual(allowlist.slice(0, 5), [
		"--permission-mode",
		"dontAsk",
		"--allowedTools",
		"Bash(npm test*)",
		"Read",
	]);
	assert.deepEqual(denied(allowlist), builtIn);
	assert.ok(!allowlist.includes("--dangerously-skip-permissions"));

	assert.ok(!permissionArgs({ mode: "allowlist" }, context).includes("--allowedTools"));
	assert.throws(() => permissionArgs({}, context), /bypass" or "allowlist/);
});

test("path rules are POSIX, a Windows drive written /c", () => {
	assert.equal(editRule(HOME), HOME_RULE);
});

const config = {
	version: 1,
	owner: { login: "alice" },
	port: 0,
	permissions: { mode: "bypass", allow: [], deny: [] },
	limits: { maxWorkers: 3, maxRunMinutes: 150 },
	projects: [{ id: "demo", mode: "live", repos: [{ slug: "o/r" }] }],
	machines: [],
	channels: [],
};
const request = (over = {}) =>
	requestRun({ kind: "judge", project: "demo", prompt: "Judge #1", cwd: os.tmpdir(), ...over });

test("a run records its session, steps, denials and summary, with the deny rules on its command line", async () => {
	write("projects/demo/live.json", { repos: { "o/r": { defaultBranch: "main" } } });
	const { id, state } = request({ items: ["o/r#1"] });
	assert.deepEqual([state, launched], ["started", [id]]);
	assert.equal(readRun(id).state, "queued");
	const done = await executeRun(id, { config, command: FAKE });
	assert.equal(done.state, "done");
	assert.equal(done.session, "00000000-0000-4000-8000-000000000001");
	assert.equal(done.step, "Reading: Judge #1");
	assert.deepEqual(done.denials, [{ tool: "Bash", input: "gh pr merge 1" }]);
	const reported = JSON.parse(done.summary);
	assert.deepEqual([reported.run, reported.project], [id, "demo"]);
	assert.ok(reported.args.includes("--dangerously-skip-permissions"));
	for (const rule of builtInDeny({ home: process.env.RUSUBAN_HOME, defaultBranches: ["main"] }))
		assert.ok(reported.args.includes(rule), rule);
	const log = fs.readFileSync(homePath(`runs/${id}/${done.log}`), "utf8");
	assert.match(log, /→ Bash gh pr merge 1/);
	assert.match(log, /denied: Bash gh pr merge 1/);
	assert.deepEqual(readRun(id), done);
	assert.equal(holder("demo.judge"), null);
});

test("a shadow project's runs are denied every GitHub write, a live project's are not", async () => {
	for (const rule of [
		"Bash(gh pr comment*)",
		"Bash(gh pr review*)",
		"Bash(gh issue close*)",
		"Bash(gh pr edit*)",
		"Bash(gh api* -X*)",
		"Bash(gh api* --method*)",
		"Bash(gh api* -f*)",
		"Bash(git push*)",
	])
		assert.ok(SHADOW_DENY.includes(rule), rule);
	assert.ok(!builtInDeny({ home: HOME }).some((r) => SHADOW_DENY.includes(r)));
	assert.deepEqual(
		builtInDeny({ home: HOME, shadow: true }).slice(-SHADOW_DENY.length),
		SHADOW_DENY,
	);
	const argsOf = async (projects) => {
		const { id } = request();
		const done = await executeRun(id, { config: { ...config, projects }, command: FAKE });
		return JSON.parse(done.summary).args;
	};
	assert.ok(!(await argsOf(config.projects)).includes("Bash(git push*)"));
	assert.ok((await argsOf([{ id: "demo", mode: "shadow" }])).includes("Bash(git push*)"));
	// A run whose project is no longer configured gets the shadow rules too.
	assert.ok((await argsOf([])).includes("Bash(gh pr comment*)"));
});

test("runs of one lock group go one after the other, in order of request", async () => {
	process.env.FAKE_CLAUDE_MS = "300";
	const a = request();
	const first = executeRun(a.id, { config, command: FAKE });
	const b = request();
	const c = request();
	assert.deepEqual([b.state, c.state], ["queued", "queued"]);
	assert.deepEqual(queued("demo.judge"), [b.id, c.id]);
	assert.equal(holder("demo.judge").run, a.id);
	await first;
	// The finished run hands over to the next one in line, and only that one.
	assert.deepEqual(launched, [a.id, b.id]);
	assert.deepEqual(queued("demo.judge"), [c.id]);
	assert.equal(request({ kind: "act" }).state, "started");
});

test("a run that fails is marked failed, and a dead runner reads as interrupted", async () => {
	process.env.FAKE_CLAUDE_EXIT = "3";
	const { id } = request();
	assert.equal((await executeRun(id, { config, command: FAKE })).state, "failed");
	delete process.env.FAKE_CLAUDE_EXIT;
	write(`runs/${id}/status.json`, { ...readRun(id), state: "running", pid: 2 ** 22 + 12345 });
	assert.equal(readRun(id).state, "interrupted");
	assert.equal(listRuns("demo")[0].id, id);
});

test("a queue whose holder died is restarted", () => {
	write("runs/locks/demo.judge.json", { pid: 2 ** 22 + 12345, run: "gone" });
	write("runs/locks/demo.judge.queue.json", ["judge-1", "judge-2"]);
	kickQueues();
	assert.deepEqual(launched, ["judge-1"]);
	assert.deepEqual(queued("demo.judge"), ["judge-2"]);
});
