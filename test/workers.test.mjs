import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeRun, listRuns, readRun, runner } from "../src/agents.mjs";
import { homePath, readJsonl, saveConfig, write } from "../src/home.mjs";
import { cleanStale, cloneOf, startWorker, stopWorker, worktreeOf } from "../src/workers.mjs";

const FAKE = [
	process.execPath,
	fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url)),
];
const launched = [];
runner.launch = (id) => launched.push(id);
const git = (args, cwd) =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

const config = {
	version: 1,
	owner: { login: "alice" },
	permissions: { mode: "bypass", allow: [], deny: [] },
	limits: { maxWorkers: 2, maxRunMinutes: 150 },
	model: "claude-test",
	projects: [{ id: "demo", title: "Demo", repos: [{ slug: "o/r" }] }],
	machines: [],
	channels: [],
};

// A scratch home whose clone of o/r already exists, from a local origin with one commit on main.
beforeEach(() => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-workers-"));
	process.env.RUSUBAN_HOME = home;
	saveConfig(config);
	launched.length = 0;
	const src = path.join(home, "src");
	fs.mkdirSync(src);
	git(["init", "-q", "-b", "main"], src);
	fs.writeFileSync(path.join(src, "README.md"), "hello\n");
	git(["add", "."], src);
	git(["commit", "-q", "-m", "first"], src);
	git(["clone", "-q", "--bare", src, path.join(home, "origin.git")], home);
	fs.mkdirSync(path.dirname(cloneOf("o/r")), { recursive: true });
	git(["clone", "-q", "--no-checkout", path.join(home, "origin.git"), cloneOf("o/r")], home);
	write("projects/demo/live.json", { repos: { "o/r": { defaultBranch: "main" } } });
});

const start = (name, item, mission = "Fix it.") =>
	startWorker({ project: "demo", name, item, mission });

test("one worker per item, each under its own name; past the limit one waits its turn", async () => {
	const first = start("fix-1", "o/r#1");
	assert.throws(() => start("fix-1", "o/r#2"), /already at work/);
	assert.throws(() => start("fix-1b", "o/r#1"), /already at work on o\/r#1/);
	start("fix-2", "o/r#2");
	assert.throws(() => start("X", "o/r#3"), /lowercase/);
	assert.throws(() => start("fix-3", "o/r#3", " "), /mission is empty/);
	// Two at work, the limit: the next two wait, without an error, and keep their names and items.
	const third = start("fix-3", "o/r#3");
	await new Promise((resolve) => setTimeout(resolve, 5)); // two runs of one millisecond: no order
	const fourth = start("fix-4", "o/r#4");
	assert.deepEqual([third.state, fourth.state, launched.length], ["queued", "queued", 2]);
	assert.throws(() => start("fix-5", "o/r#3"), /already at work on o\/r#3/);
	// A worker stops: the one that waited longest starts, the other still waits.
	stopWorker("demo", "fix-2");
	assert.deepEqual(launched.slice(2), [third.id]);
	assert.equal(readRun(fourth.id).state, "queued");
	assert.ok(launched.includes(first.id));
});

test("a waiting worker starts as soon as a worker ends", async () => {
	const first = start("fix-1", "o/r#1");
	start("fix-2", "o/r#2");
	const waiting = start("fix-3", "o/r#3");
	assert.ok(!launched.includes(waiting.id));
	assert.equal((await executeRun(first.id, { config, command: FAKE })).state, "done");
	assert.ok(launched.includes(waiting.id));
});

test("a worker runs in its own worktree, reports once to the coordinator, and its worktree goes", async () => {
	const { id } = start("fix-5", "o/r#5", "Fix the crash in #5.");
	const done = await executeRun(id, { config, command: FAKE });
	assert.equal(done.state, "done");
	const reported = JSON.parse(done.summary);
	assert.deepEqual(
		[done.model, reported.args[reported.args.indexOf("--model") + 1]],
		["claude-test", "claude-test"],
	);
	assert.equal(
		fs.realpathSync.native(path.dirname(reported.cwd)),
		fs.realpathSync.native(path.dirname(worktreeOf("demo", id))),
	);
	assert.equal(path.basename(reported.cwd), id);
	assert.ok(!fs.existsSync(worktreeOf("demo", id)), "the worktree is removed at the end");
	assert.doesNotMatch(git(["worktree", "list"], cloneOf("o/r")), new RegExp(id));
	const reports = readJsonl("projects/demo/reports.jsonl");
	assert.deepEqual(
		reports.map((r) => [r.worker, r.item, r.state, r.run]),
		[["fix-5", "o/r#5", "done", id]],
	);
	const coordinator = listRuns("demo").find((r) => r.kind === "act");
	assert.deepEqual([coordinator.trigger, launched.includes(coordinator.id)], ["worker", true]);
});

test("a worker that cannot get its worktree fails, and still reports", async () => {
	write("projects/demo/live.json", { repos: { "o/r": { defaultBranch: "nope" } } });
	const { id } = start("fix-6", "o/r#6");
	const done = await executeRun(id, { config, command: FAKE });
	assert.equal(done.state, "failed");
	assert.match(done.summary, /^Could not start/);
	assert.equal(readJsonl("projects/demo/reports.jsonl")[0].state, "failed");
});

test("stale worktrees are cleaned at start, a live run's kept", () => {
	const { id } = start("fix-7", "o/r#7");
	fs.mkdirSync(worktreeOf("demo", id), { recursive: true });
	fs.mkdirSync(worktreeOf("demo", "worker-gone"), { recursive: true });
	assert.deepEqual(cleanStale("demo", ["o/r"]), ["worker-gone"]);
	assert.ok(fs.existsSync(worktreeOf("demo", id)));
	write(`runs/${id}/status.json`, { ...readRun(id), state: "done" });
	assert.deepEqual(cleanStale("demo", ["o/r"]), [id]);
	assert.ok(!fs.existsSync(homePath(`worktrees/demo/${id}`)));
});
