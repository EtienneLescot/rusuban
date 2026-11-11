import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeRun, holder, NO_MODEL, queued, readRun, runner } from "../src/agents.mjs";
import { homePath, readJsonl, saveConfig, write } from "../src/home.mjs";
import { agentsState, runSchedule, startServer } from "../src/server.mjs";
import { dueTasks, lastSlot, nextSlot, parseSchedule, parseTask } from "../src/tasks.mjs";

const FAKE = [
	process.execPath,
	fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url)),
];
const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
const launched = [];
runner.launch = (id) => launched.push(id);

let config;
beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-tasks-"));
	launched.length = 0;
	delete process.env.FAKE_CLAUDE_MS;
	config = saveConfig({
		version: 1,
		owner: { login: "alice" },
		permissions: { mode: "bypass", allow: [], deny: [] },
		limits: { maxWorkers: 3, maxRunMinutes: 150 },
		model: "claude-test",
		projects: [{ id: "sandbox", repos: [{ slug: "o/sandbox" }] }],
	});
});

// Local times on fixed days of November 2026, as a schedule is written.
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m).getTime();
const iso = (t) => new Date(t).toISOString();
const text = (meta, prompt = "Write the digest.") => `---\n${meta}\n---\n${prompt}\n`;
const task = (meta, since = at(1, 8), id = "digest") => parseTask(id, text(meta), config, since);
// A task file in the instance home, written long before its slots.
function taskFile(id, meta) {
	fs.mkdirSync(homePath("tasks"), { recursive: true });
	const file = homePath(`tasks/${id}.md`);
	fs.writeFileSync(file, text(meta));
	const old = new Date(Date.now() - 3 * 86400e3);
	fs.utimesSync(file, old, old);
}

test("a schedule is daily, at one time or several", () => {
	assert.deepEqual(parseSchedule("daily 09:00,17:30"), {
		slots: [
			[9, 0],
			[17, 30],
		],
	});
	assert.deepEqual(parseSchedule(" daily 7:05 "), { slots: [[7, 5]] });
	for (const bad of [
		"weekly 09:00",
		"daily",
		"daily 24:00",
		"daily 09:60",
		"daily 9h",
		"daily 09:00,",
	])
		assert.ok(parseSchedule(bad).error, bad);
});

test("a task file is its front matter then its prompt; a task with a mistake carries it", () => {
	const ok = task(
		"title: Digest\nproject: sandbox\nschedule: daily 09:00\nlock: sandbox.coordinator",
	);
	assert.deepEqual(
		[ok.error, ok.title, ok.project, ok.lock, ok.cwd, ok.prompt, ok.slots],
		[null, "Digest", "sandbox", "sandbox.coordinator", null, "Write the digest.", [[9, 0]]],
	);
	// Written on Windows.
	const crlf = parseTask("d", text("project: sandbox").replace(/\n/g, "\r\n"), config);
	assert.deepEqual([crlf.error, crlf.prompt], [null, "Write the digest."]);
	// Without a lock a task is its own group; without a schedule it runs on a click only.
	const bare = task("project: sandbox", 0, "bare");
	assert.deepEqual(
		[bare.error, bare.title, bare.lock, bare.slots],
		[null, "bare", "sandbox.task.bare", []],
	);
	assert.equal(task(`project: sandbox\ncwd: ${os.tmpdir()}`).cwd, os.tmpdir());
	assert.equal(task("# runs on a click\nproject: sandbox").error, null);
	assert.match(task("project: sandbox", 0, "Weekly_Digest").error, /file name is lowercase/);
	for (const [file, why] of [
		["Write the digest.", /front matter/],
		[text("project: sandbox\nowner: bob"), /unknown field "owner"/],
		[text("Project: sandbox"), /unknown field "Project"/],
		[
			text("project: sandbox\nschedule daily 09:00"),
			/"schedule daily 09:00" is not "field: value"/,
		],
		[text("project: elsewhere"), /project "elsewhere" is none of this instance's: sandbox/],
		[text("title: Digest"), /project names none of this instance's: sandbox/],
		[text("project: sandbox\nschedule: weekly 09:00"), /schedule is "daily HH:MM"/],
		[text("project: sandbox\nlock: a b"), /lock is letters/],
		[text("project: sandbox\ncwd: relative/dir"), /not an existing absolute folder/],
		[text("project: sandbox", ""), /prompt after the front matter is empty/],
	])
		assert.match(parseTask("x", file, config).error, why);
});

test("the last slot looks back a day, so a slot missed overnight still counts", () => {
	const slots = [
		[9, 0],
		[17, 30],
	];
	assert.equal(lastSlot(slots, at(7, 10)), at(7, 9));
	assert.equal(lastSlot(slots, at(7, 9)), at(7, 9));
	assert.equal(lastSlot(slots, at(7, 8)), at(6, 17, 30));
	assert.equal(nextSlot(slots, at(7, 10)), at(7, 17, 30));
	assert.equal(nextSlot(slots, at(7, 18)), at(8, 9));
	assert.equal(lastSlot([], at(7, 10)), null);
});

test("slots missed while the daemon was down start the task once", () => {
	const t = task("project: sandbox\nschedule: daily 09:00,12:00,17:00");
	const runs = [{ id: "r1", task: "digest", state: "done", createdAt: iso(at(6, 8)) }];
	// Down from yesterday 08:00 to 18:00 today: three slots passed, one start.
	assert.deepEqual(
		dueTasks({ tasks: [t], runs, now: at(7, 18) }).map((d) => [d.task.id, d.slot]),
		[["digest", at(7, 17)]],
	);
	runs.unshift({ id: "r2", task: "digest", state: "done", createdAt: iso(at(7, 18)) });
	assert.deepEqual(dueTasks({ tasks: [t], runs, now: at(7, 23) }), []);
	assert.equal(dueTasks({ tasks: [t], runs, now: at(8, 9, 1) }).length, 1);
	// A late slot missed by a machine off for the night starts the next morning.
	const late = task("project: sandbox\nschedule: daily 23:00", at(1, 8), "late");
	assert.equal(dueTasks({ tasks: [late], runs: [], now: at(8, 8) })[0].slot, at(7, 23));
});

test("a task that waits, works or will be asked again is not started twice", () => {
	const t = task("project: sandbox\nschedule: daily 09:00");
	const run = (state, more = {}) => ({
		id: "r",
		task: "digest",
		state,
		createdAt: iso(at(6, 9)),
		...more,
	});
	for (const r of [run("queued"), run("running"), run("limited"), run("interrupted")])
		assert.deepEqual(dueTasks({ tasks: [t], runs: [r], now: at(7, 10) }), [], r.state);
	// A run asked again already handed its turn over; a run lost three times is over.
	for (const r of [
		run("limited", { retriedBy: "r2" }),
		run("interrupted", { attempt: 3 }),
		run("failed"),
		run("stopped"),
	])
		assert.equal(dueTasks({ tasks: [t], runs: [r], now: at(7, 10) }).length, 1, r.state);
});

test("a new task waits for its next slot; one with a mistake or no schedule is never due", () => {
	const fresh = task("project: sandbox\nschedule: daily 09:00,17:30", at(7, 10));
	assert.deepEqual(dueTasks({ tasks: [fresh], runs: [], now: at(7, 10, 30) }), []);
	assert.equal(dueTasks({ tasks: [fresh], runs: [], now: at(7, 17, 31) })[0].slot, at(7, 17, 30));
	const broken = task("project: elsewhere\nschedule: daily 09:00", at(1, 8), "broken");
	const onClick = task("project: sandbox", at(1, 8), "click");
	assert.deepEqual(dueTasks({ tasks: [broken, onClick], runs: [], now: at(7, 10) }), []);
});

test("two due tasks sharing a lock run one after the other, and each end is journaled once", async () => {
	// Their slot was a minute ago, on the real clock: the runs carry real start times.
	const d = new Date(Date.now() - 60_000);
	const schedule = `daily ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
	for (const [id, title] of [
		["a-digest", "Digest"],
		["b-triage", "Triage"],
	])
		taskFile(id, `title: ${title}\nproject: sandbox\nschedule: ${schedule}\nlock: sandbox.reports`);
	const ctx = { config, dry: false };
	const [a, b, ...more] = runSchedule(ctx);
	assert.deepEqual([a.task, b.task, more], ["a-digest", "b-triage", []]);
	assert.deepEqual([readRun(a.id).trigger, readRun(a.id).lock], ["schedule", "sandbox.reports"]);

	process.env.FAKE_CLAUDE_MS = "300";
	const first = executeRun(a.id, { config, command: FAKE });
	// The second runner finds the group taken: back to the queue, nothing done.
	assert.equal((await executeRun(b.id, { config, command: FAKE })).state, "queued");
	assert.equal(holder("sandbox.reports").run, a.id);
	assert.deepEqual(queued("sandbox.reports"), [b.id]);
	assert.equal((await first).state, "done");
	// The first one's end hands the group to the second.
	assert.equal(launched.at(-1), b.id);
	assert.equal((await executeRun(b.id, { config, command: FAKE })).state, "done");
	// The run knows which task it is and what started it (found missing in the live check).
	const prompt = fs.readFileSync(homePath(`runs/${b.id}/prompt.md`), "utf8");
	assert.match(prompt, /a task run of the task `b-triage` \(“Triage”\), started at its time\./);
	assert.match(prompt, /# Your task\n\nWrite the digest\./);

	// Both started for this slot: none again; each end goes to the journal once.
	assert.deepEqual(runSchedule(ctx), []);
	runSchedule(ctx);
	const journal = readJsonl("projects/sandbox/journal.jsonl");
	assert.deepEqual(
		journal.filter((e) => e.kind === "task").map((e) => [e.text, e.by, e.run]),
		[
			["Started the task “Digest” at its time", "server", a.id],
			["Started the task “Triage” at its time", "server", b.id],
		],
	);
	const ends = journal.filter((e) => e.kind === "task-end");
	assert.deepEqual(ends.map((e) => e.run).sort(), [a.id, b.id].sort());
	assert.ok(ends.every((e) => !e.notify && /^(Digest|Triage), done: /.test(e.text)));
	// A dry daemon starts nothing.
	assert.deepEqual(runSchedule({ config, dry: true }), []);
});

test("a task that failed is journaled for the owner", () => {
	write("runs/task-1/status.json", {
		id: "task-1",
		kind: "task",
		task: "digest",
		title: "Digest",
		project: "sandbox",
		state: "failed",
		createdAt: iso(Date.now()),
		summary: "Could not start: no such folder\nmore",
	});
	runSchedule({ config, dry: false });
	const [end] = readJsonl("projects/sandbox/journal.jsonl");
	assert.deepEqual(
		[end.kind, end.text, end.notify],
		["task-end", "Digest, failed: Could not start: no such folder", true],
	);
});

// ── The daemon's routes and the command line ──────────────────────────────────────────────────
function call(port, method, urlPath, headers = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (c) => {
				body += c;
			});
			res.on("end", () =>
				resolve({
					status: res.statusCode,
					body: /json/.test(res.headers["content-type"]) ? JSON.parse(body) : body,
				}),
			);
		});
		req.on("error", reject);
		req.end();
	});
}

test("without a model no task starts on a click: the page is told why, and knows it", async () => {
	saveConfig({ ...config, model: undefined });
	taskFile("digest", "title: Digest\nproject: sandbox");
	const srv = await startServer({ port: 0, polling: false, quiet: true, tailnet: null });
	try {
		const r = await call(srv.port, "POST", "/api/tasks/digest/run", {
			origin: `http://127.0.0.1:${srv.port}`,
			"x-rusuban": "1",
		});
		assert.deepEqual([r.status, r.body.error, launched], [409, NO_MODEL, []]);
		assert.equal((await call(srv.port, "GET", "/api/state")).body.runModel, null);
		assert.equal(agentsState(srv.ctx, "sandbox").runModel, null);
	} finally {
		await srv.close();
	}
});

test("the catalog is served with each task's slots, state and runs; a task starts on a click", async () => {
	taskFile("digest", "title: Digest\nproject: sandbox\nschedule: daily 09:00,17:30");
	taskFile("broken", "project: elsewhere");
	const srv = await startServer({ port: 0, polling: false, quiet: true, tailnet: null });
	const post = (id, headers = {}) =>
		call(srv.port, "POST", `/api/tasks/${id}/run`, {
			origin: `http://127.0.0.1:${srv.port}`,
			"x-rusuban": "1",
			...headers,
		});
	try {
		const listed = (await call(srv.port, "GET", "/api/tasks")).body.tasks;
		assert.deepEqual(
			listed.map((t) => [t.id, t.state, !!t.error]),
			[
				["broken", "idle", true],
				["digest", "idle", false],
			],
		);
		const digest = listed[1];
		assert.equal(digest.cwd, homePath("scratch/sandbox"));
		assert.ok(
			Date.parse(digest.lastSlot) <= Date.now() && Date.parse(digest.nextSlot) > Date.now(),
		);

		const started = await post("digest");
		assert.equal(started.status, 200);
		const run = readRun(started.body.run);
		assert.deepEqual(
			[run.kind, run.task, run.trigger, run.title],
			["task", "digest", "button", "Digest"],
		);
		assert.equal((await post("digest")).status, 409);
		assert.equal((await post("broken")).status, 400);
		assert.equal((await post("nope")).status, 404);
		assert.equal((await post("digest", { "x-rusuban": "0" })).status, 403);

		const again = (await call(srv.port, "GET", "/api/tasks")).body.tasks[1];
		assert.deepEqual(
			[again.state, again.runs[0].id, again.runs[0].trigger],
			["queued", run.id, "button"],
		);
		const [entry] = readJsonl("projects/sandbox/journal.jsonl");
		assert.deepEqual([entry.text, entry.by], ["Started the task “Digest”", "alice"]);

		// The page pushes the project's runs and tasks, each with the start of its prompt.
		const pushed = agentsState(srv.ctx, "sandbox");
		assert.deepEqual(
			[pushed.dry, pushed.runs.map((r) => r.id), pushed.tasks[1].promptStart],
			[false, [run.id], "Write the digest."],
		);
		// A task's file and a run's log open as text; nothing else does.
		const get = (p) => call(srv.port, "GET", p);
		assert.deepEqual(Object.values(await get("/api/tasks/digest/file")), [
			200,
			fs.readFileSync(homePath("tasks/digest.md"), "utf8"),
		]);
		assert.equal((await get("/api/tasks/nope/file")).status, 404);
		assert.equal((await get("/api/tasks/..%2Fconfig/file")).status, 404);
		assert.equal((await get(`/api/runs/${run.id}/log`)).status, 404); // queued: no log yet
		write(`runs/${run.id}/status.json`, { ...readRun(run.id), log: "a.log" });
		fs.writeFileSync(homePath(`runs/${run.id}/a.log`), "09:00:01  → Bash gh pr list\n");
		assert.deepEqual(Object.values(await get(`/api/runs/${run.id}/log`)), [
			200,
			"09:00:01  → Bash gh pr list\n",
		]);
		write(`runs/${run.id}/status.json`, { ...readRun(run.id), log: "../../config.json" });
		assert.equal((await get(`/api/runs/${run.id}/log`)).status, 404);
		assert.equal((await get("/api/runs/..%2Fconfig/log")).status, 404);
	} finally {
		await srv.close();
	}
});

test("a page gets its project's runs, tasks and conversations; a task of no project, every page", async () => {
	saveConfig({
		...config,
		projects: [...config.projects, { id: "posts", repos: [] }],
		machines: [{ name: "mac", os: "macos", ssh: "mac", caps: [] }],
	});
	taskFile("digest", "title: Digest\nproject: sandbox");
	taskFile("post", "title: Post\nproject: posts");
	taskFile("broken", "project: elsewhere");
	for (const [id, project] of [
		["r1", "sandbox"],
		["r2", "posts"],
	])
		write(`runs/${id}/status.json`, {
			id,
			kind: "task",
			project,
			state: "done",
			createdAt: iso(0),
		});
	const srv = await startServer({ port: 0, polling: false, quiet: true, tailnet: null });
	try {
		// A project's conversations: one about its item, one of Rusuban's runs on it (FR-102).
		const session = (id, project, over) => ({ id, project, title: id, lastAt: iso(0), ...over });
		srv.ctx.hubIndex = {
			sessions: {
				a: session("a", "sandbox", { items: ["o/sandbox#1"] }),
				b: session("b", "posts", { items: [], run: "r2" }),
			},
		};
		// What the server pushes to a page that asked for this project.
		const page = (project) => {
			const got = {};
			const res = {
				write: (s) => {
					const [, event, data] = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(s);
					got[event] = JSON.parse(data);
				},
			};
			srv.ctx.push({ project, res }, true);
			const { agents, hub } = got;
			return [
				got.state.project.id,
				agents.runs.map((r) => r.id),
				agents.tasks.map((t) => t.id),
				agents.machines?.machines.map((m) => m.name) ?? null,
				hub.conversations.map((c) => c.id),
			];
		};
		assert.deepEqual(page("posts"), ["posts", ["r2"], ["broken", "post"], null, ["b"]]);
		const sandbox = ["sandbox", ["r1"], ["broken", "digest"], ["mac"], ["a"]];
		assert.deepEqual(page("sandbox"), sandbox);
		// No project asked, or one the instance lacks: the first project's, as the state says.
		assert.deepEqual(page(null), sandbox);
		assert.deepEqual(page("gone"), sandbox);
		// The task of no project says which it names.
		assert.match(
			agentsState(srv.ctx, "posts").tasks[0].error,
			/project "elsewhere" is none of this instance's: sandbox, posts/,
		);
	} finally {
		await srv.close();
	}
});

test("task list shows the catalog; task run starts one, and refuses a busy or broken one", () => {
	taskFile("digest", "title: Digest\nproject: sandbox\nlock: sandbox.reports");
	taskFile("broken", "project: elsewhere");
	taskFile("Weekly_Digest", "project: sandbox");
	// The group is held by this live process: the run waits in its queue and nothing is launched.
	write("runs/locks/sandbox.reports.json", { pid: process.pid, run: "other" });
	const cli = (...args) =>
		spawnSync(process.execPath, [BIN, "task", ...args], { encoding: "utf8" });
	assert.deepEqual(
		JSON.parse(cli("list").stdout).map((t) => [t.id, !!t.error]),
		[
			["broken", true],
			["digest", false],
			["Weekly_Digest", true],
		],
	);
	// A badly named file is listed with its error, and never started.
	assert.match(cli("run", "Weekly_Digest").stderr, /no task "Weekly_Digest"/);
	const ran = cli("run", "digest");
	assert.equal(ran.status, 0, ran.stderr);
	const id = /\(run ([\w-]+)\)/.exec(ran.stdout)[1];
	assert.match(ran.stdout, /^task digest queued \(run /);
	assert.deepEqual([readRun(id).trigger, queued("sandbox.reports")], ["manual", [id]]);
	assert.match(cli("run", "digest").stderr, /already waits or works/);
	assert.match(
		cli("run", "broken").stderr,
		/^refused: task broken: project "elsewhere" is none of this instance.s: sandbox$/m,
	);
	assert.match(cli("run", "nope").stderr, /no task "nope"/);
	assert.match(cli("run").stderr, /usage: task list \| task run <id>/);
});
