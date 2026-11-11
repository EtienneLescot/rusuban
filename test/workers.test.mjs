import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeRun, kickQueues, listRuns, readRun, runner } from "../src/agents.mjs";
import { homePath, readJsonl, saveConfig, write } from "../src/home.mjs";
import {
	cloneOf,
	disk,
	releaseFiles,
	startWorker,
	stopWorker,
	sweep,
	workDirOf,
	worktreeOf,
	wsl,
} from "../src/workers.mjs";

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

// WSL and the disks are the test's: what a run asks of WSL is kept, and every disk has room.
const wslCalls = [];
let wslOut = "";
wsl.run = async (script) => {
	wslCalls.push(script);
	return wslOut;
};

// A scratch home whose clone of o/r already exists, from a local origin with one commit on main.
beforeEach(() => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-workers-"));
	process.env.RUSUBAN_HOME = home;
	saveConfig(config);
	launched.length = 0;
	wslCalls.length = 0;
	wslOut = "";
	disk.free = () => 100e9;
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

test("a worker gets a work folder in its prompt, env and tools, and it goes with the run", async () => {
	const { id } = start("fix-8", "o/r#8");
	const done = await executeRun(id, { config, command: FAKE });
	const work = workDirOf(id, config);
	const reported = JSON.parse(done.summary);
	assert.equal(reported.work, work);
	assert.equal(reported.args[reported.args.indexOf("--add-dir") + 1], work);
	const prompt = fs.readFileSync(homePath(`runs/${id}/prompt.md`), "utf8");
	assert.ok(prompt.includes(`- Your work folder: \`${work}\``));
	assert.equal(readRun(id).workDir, work);
	assert.ok(!fs.existsSync(work), "the work folder goes with the run, and what was built in it");
	// In WSL, its own folder goes too, named by its run id alone.
	if (process.platform === "win32")
		assert.deepEqual(wslCalls, [`cd "$HOME/rusuban-work" 2>/dev/null && rm -rf -- ${id}`]);
});

test("removing a run's folders never follows a junction", async () => {
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-checkout-"));
	fs.writeFileSync(path.join(outside, "keep.txt"), "a person's file\n");
	const id = "worker-20261111000000-abcd";
	const workDir = workDirOf(id, config);
	const worktree = worktreeOf("demo", id);
	for (const dir of [workDir, worktree]) {
		fs.mkdirSync(dir, { recursive: true });
		fs.symlinkSync(outside, path.join(dir, "node_modules"), "junction");
	}
	await releaseFiles({ id, items: ["o/r#1"], workDir, worktree });
	assert.ok(!fs.existsSync(workDir) && !fs.existsSync(worktree));
	assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "a person's file\n");
});

test("the sweep removes what ended runs left, never a live run's nor another instance's", async () => {
	const root = homePath("work");
	const live = start("fix-9", "o/r#9");
	const ended = start("fix-10", "o/r#10");
	const crashed = start("fix-11", "o/r#11");
	const status = (run, over) =>
		write(`runs/${run.id}/status.json`, { ...readRun(run.id), ...over });
	const folders = (run) => [path.join(root, run.id), worktreeOf("demo", run.id)];
	for (const dir of [...folders(live), ...folders(ended), path.join(root, crashed.id)])
		fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(path.join(root, ended.id, "target"));
	status(live, { workDir: folders(live)[0], worktree: folders(live)[1] });
	status(ended, {
		state: "done",
		workDir: folders(ended)[0],
		worktree: folders(ended)[1],
		wslWork: `rusuban-work/${ended.id}`,
	});
	// One that crashed before its status named its work folder.
	status(crashed, { state: "failed" });
	// Another instance's run, in a work root they share: unknown here, so kept.
	const foreign = path.join(root, "worker-20260101000000-beef");
	fs.mkdirSync(foreign);
	fs.mkdirSync(worktreeOf("demo", "worker-gone"), { recursive: true });
	wslOut = `${ended.id}\nworker-20260101000000-beef\n`;
	// 2 GB more room once the ended run's build output is gone.
	disk.free = () => (fs.existsSync(path.join(root, ended.id, "target")) ? 50e9 : 52e9);

	const gone = await sweep(config);
	assert.ok(folders(live).every((d) => fs.existsSync(d)));
	assert.ok(fs.existsSync(foreign));
	for (const dir of [
		...folders(ended),
		path.join(root, crashed.id),
		worktreeOf("demo", "worker-gone"),
	])
		assert.ok(!fs.existsSync(dir), dir);
	assert.deepEqual(wslCalls.slice(1), [
		`cd "$HOME/rusuban-work" 2>/dev/null && rm -rf -- ${ended.id}`,
	]);
	assert.deepEqual([gone.get("demo").folders.length, gone.get("demo").bytes], [5, 2e9]);
	wslOut = "worker-20260101000000-beef\n";
	assert.equal((await sweep(config)).size, 0, "nothing left the next time");
});

test("a worktree of the clone outside every run's folders goes once no worker lives", async () => {
	const legacy = path.join(process.env.RUSUBAN_HOME, "tmp-legacy", "wt");
	git(["worktree", "add", "-q", "--detach", legacy, "origin/main"], cloneOf("o/r"));
	const w = start("fix-12", "o/r#12");
	await sweep(config);
	assert.ok(fs.existsSync(legacy), "maybe the live worker's, made before work folders");
	write(`runs/${w.id}/status.json`, { ...readRun(w.id), state: "done" });
	await sweep(config);
	assert.ok(!fs.existsSync(legacy));
	assert.doesNotMatch(git(["worktree", "list"], cloneOf("o/r")), /tmp-legacy/);
});

test("the sweep never takes the clone for a stray worktree, the home reached through a link", async () => {
	// macOS's tmpdir is such a link: git names the clone by its real path, /private/var/…
	const real = process.env.RUSUBAN_HOME;
	const linked = `${real}-link`;
	fs.symlinkSync(real, linked, "junction");
	process.env.RUSUBAN_HOME = linked;
	await sweep(config);
	assert.ok(fs.existsSync(path.join(cloneOf("o/r"), ".git")), "the clone stays");
	fs.rmSync(linked, { recursive: true, force: true });
	assert.ok(fs.existsSync(path.join(real, "repos", "o", "r", ".git")), "a link goes alone");
});

test("short of room, a worker waits with the reason in its status, and starts once there is", () => {
	disk.free = () => 4.2e9;
	const { id, state } = start("fix-13", "o/r#13");
	assert.equal(state, "queued");
	assert.ok(!launched.includes(id));
	assert.match(readRun(id).step, /^Waits for room: 4\.2 GB free on .+, 10 GB needed$/);
	// A drive unplugged has no room either: the queues go on.
	disk.free = () => {
		throw new Error("ENOENT: no such drive");
	};
	kickQueues();
	assert.match(readRun(id).step, /^Waits for room: .+ cannot be read$/);
	disk.free = () => 100e9;
	kickQueues();
	assert.ok(launched.includes(id));
	assert.equal(readRun(id).step, null);
});
