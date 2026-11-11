// Several projects in one instance (US7, T044 to T046): one inbox for all, and nothing of one
// project read or written by another: judgment, journal, rules, locks, answers. A real daemon reads a
// fake GitHub and starts recorders instead of agents; the owner's `project` commands change its
// config while it runs.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { assemblePrompt, CARD_RULES } from "../src/agents.mjs";
import { homePath, read, readJsonl, saveConfig, validateConfig, write } from "../src/home.mjs";
import { applyJudgment } from "../src/model.mjs";
import { reloadConfig, startServer } from "../src/server.mjs";
import { confirmRequest, pendingRequests } from "../src/settings.mjs";
import { parseTask } from "../src/tasks.mjs";

const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
const NOW = "2026-11-08T12:00:00.000Z";
const pr = (repo, n) => ({
	repo,
	n,
	title: `PR ${n}`,
	url: `https://github.com/${repo}/pull/${n}`,
	author: "a",
	draft: false,
	head: `sha${n}`,
	base: "main",
	files: [{ path: "src/a.js", additions: 3, deletions: 1, change: "MODIFIED" }],
	filesTruncated: false,
	refs: [],
	closes: [],
	mergeable: "MERGEABLE",
	canBeRebased: true,
	ci: { state: "success", runId: null, runIds: [], waiting: [] },
	checks: [{ name: "test", workflow: "CI", state: "success" }],
	reviews: {},
	threadsOpen: 0,
	createdAt: NOW,
	updatedAt: NOW,
});
const issue = (repo, n) => ({
	repo,
	n,
	title: `Issue ${n}`,
	url: `https://github.com/${repo}/issues/${n}`,
	author: "b",
	labels: [],
	comments: 0,
	createdAt: NOW,
	updatedAt: NOW,
});
const repoState = (prs = [], issues = []) => ({
	defaultBranch: "main",
	prs,
	issues,
	merged: [],
	pushes: [],
	checkedAt: NOW,
	changedAt: NOW,
	error: null,
});
// The fake GitHub: what each repo holds, and its rules on the default branch.
const GITHUB = {
	"a/one": repoState([pr("a/one", 1)], [issue("a/one", 3), issue("a/one", 10)]),
	"b/two": repoState([pr("b/two", 2)], [issue("b/two", 20)]),
};
const OBSERVE = {
	observeOnly: true,
	ref: "main",
	treeSha: null,
	files: [],
	locks: null,
	errors: [],
};
const RULES = {
	"a/one": {
		observeOnly: false,
		ref: "main",
		treeSha: "t-a",
		files: [{ name: "01.md", text: "Fixes merge alone." }],
		locks: { mergeMethod: "squash" },
		errors: [],
	},
};

let reads;
let merged;
let runs;
let coordinators;
const deps = {
	read: async (project) => {
		reads.push(project.id);
		return {
			checkedAt: new Date().toISOString(),
			repos: Object.fromEntries(
				project.repos.map(({ slug }) => [slug, GITHUB[slug] ?? repoState()]),
			),
			rate: null,
		};
	},
	loadRules: async (slug) => RULES[slug] ?? OBSERVE,
	merge: async (a) => merged.push(a),
	requestRun: (o) => {
		runs.push(o);
		return { id: `${o.kind}-${runs.length}`, state: "started" };
	},
	requestCoordinator: (project, trigger) => {
		coordinators.push([project, trigger]);
		return { id: `act-${coordinators.length}`, state: "started" };
	},
};

const projects = () => [
	{ id: "alpha", repos: [{ slug: "a/one" }] },
	{ id: "beta", repos: [{ slug: "b/two" }] },
];
// Port 0: a command never asks a daemon of this machine, only the one a test starts.
const configOf = (over = {}) => ({
	version: 1,
	owner: { login: "alice" },
	port: 0,
	permissions: { mode: "allowlist" },
	limits: { maxWorkers: 3, maxRunMinutes: 150 },
	model: "claude-test",
	projects: projects(),
	...over,
});
beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-projects-"));
	reads = [];
	merged = [];
	runs = [];
	coordinators = [];
	saveConfig(configOf());
});

const card = {
	urgency: "digest",
	done: "I read the thread.",
	q: "Build it?",
	ctx: "Asked by two users.",
	rec: "build",
	why: "Small and wanted.",
	options: [
		{ id: "build", label: "Build it", effect: "I open a PR." },
		{ id: "close", label: "Close it", effect: "I close it, kindly." },
	],
};
// A project's judgment: its PR judged to merge alone on its head, and a card to alice on its
// issue, written under the product's card rules as they are, as the agent CLI writes it.
function judge(project, slug, prN, issueN) {
	const live = { prs: GITHUB[slug].prs, issues: GITHUB[slug].issues };
	const judgment = { items: {} };
	const at = { repos: [slug], now: NOW, stamp: CARD_RULES };
	applyJudgment(
		{
			n: prN,
			label: `Fix ${prN}`,
			kind: "bug",
			owner: "agent",
			next: "Merges once green.",
			revisitAt: "2099-01-01T00:00:00Z",
			pr: { head: `sha${prN}`, auto: true, why: "A fix." },
		},
		live,
		judgment,
		at,
	);
	const d = applyJudgment(
		{
			n: issueN,
			label: `Ask ${issueN}`,
			kind: "feature",
			owner: "alice",
			next: "Alice decides.",
			decision: card,
		},
		live,
		judgment,
		at,
	).decision;
	write(`projects/${project}/judgment.json`, judgment);
	return d;
}

async function until(done, ms = 5000) {
	const end = Date.now() + ms;
	while (!done()) {
		if (Date.now() > end) throw new Error("timed out");
		await new Promise((r) => setTimeout(r, 25));
	}
}

function call(srv, method, urlPath, body) {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: "127.0.0.1",
				port: srv.port,
				method,
				path: urlPath,
				headers: { origin: `http://127.0.0.1:${srv.port}`, "x-rusuban": "1" },
			},
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (c) => {
					text += c;
				});
				res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
			},
		);
		req.on("error", reject);
		if (body !== undefined) req.write(JSON.stringify(body));
		req.end();
	});
}

// The owner's command, in its own process: the daemon of this process keeps answering meanwhile.
const cli = (...args) =>
	new Promise((resolve) =>
		execFile(process.execPath, [BIN, ...args], { encoding: "utf8" }, (e, stdout, stderr) =>
			resolve({ status: e ? e.code : 0, stdout, stderr }),
		),
	);

test("a repo belongs to one project, whatever the case of its name", () => {
	assert.throws(
		() =>
			validateConfig(
				configOf({
					projects: [...projects(), { id: "gamma", repos: [{ slug: "A/One" }] }],
				}),
			),
		/projects\[2\]: repo A\/One is already in project "alpha"/,
	);
});

test("two projects: each loop reads, merges and starts agents on its own; one inbox, answers kept apart", async () => {
	write("automerge.json", { armed: true });
	const cardA = judge("alpha", "a/one", 1, 10);
	const cardB = judge("beta", "b/two", 2, 20);
	// Planted in beta's rules: locks that would stop every merge of a/one, had alpha read them.
	write("projects/beta/rules.json", {
		"a/one": {
			...RULES["a/one"],
			files: [{ name: "99.md", text: "Nothing merges." }],
			locks: { lockedPaths: ["**"] },
		},
	});
	const srv = await startServer({ port: 0, quiet: true, tailnet: null, deps });
	try {
		await until(
			() => merged.length && runs.length && fs.existsSync(homePath("projects/beta/live.json")),
		);
		// Each project's files hold its own repos.
		assert.deepEqual(Object.keys(read("projects/alpha/live.json").repos), ["a/one"]);
		assert.deepEqual(Object.keys(read("projects/beta/live.json").repos), ["b/two"]);
		assert.deepEqual(read("projects/alpha/rules.json")["a/one"].files[0].name, "01.md");
		assert.equal(read("projects/beta/rules.json")["b/two"].observeOnly, true);
		// Alpha's rules let its PR merge; beta has none, so its PR judged to merge alone stays, and
		// alpha's merge never read beta's locks.
		assert.deepEqual(merged, [
			{ slug: "a/one", n: 1, method: "squash", head: "sha1", admin: false },
		]);
		// Only alpha has something to judge, under its own coordinator lock.
		assert.deepEqual(
			runs.map((r) => [r.kind, r.project, r.items, r.lock]),
			[["judge", "alpha", ["a/one#3"], "alpha.coordinator"]],
		);
		const kinds = (p) =>
			readJsonl(`projects/${p}/journal.jsonl`).map((e) => `${e.kind} ${e.item ?? ""}`.trim());
		assert.deepEqual(kinds("alpha"), ["merge a/one#1"]);
		assert.deepEqual(kinds("beta"), []);
		// A run of beta is told beta's rules only: none.
		const prompt = assemblePrompt({
			kind: "act",
			project: "beta",
			config: srv.ctx.config,
			run: "act-0",
		});
		assert.match(prompt, /No repo of this project has rules yet/);
		assert.doesNotMatch(prompt, /merges? alone|Nothing merges/);
		assert.match(
			assemblePrompt({ kind: "act", project: "alpha", config: srv.ctx.config, run: "act-0" }),
			/Fixes merge alone\./,
		);

		// One inbox: both cards, each with its project.
		const inbox = (await call(srv, "GET", "/api/inbox")).body;
		assert.deepEqual(inbox.cards.map((c) => `${c.project} ${c.item}`).sort(), [
			"alpha a/one#10",
			"beta b/two#20",
		]);
		// Beta's card cannot be answered as alpha's.
		const crossed = await call(srv, "POST", "/api/answer", {
			project: "alpha",
			item: "b/two#20",
			card: cardB.id,
			option: "build",
		});
		assert.deepEqual(
			[crossed.status, crossed.body.error],
			[400, "b/two is not a repo of this project"],
		);
		const answered = await call(srv, "POST", "/api/answer", {
			project: "beta",
			item: "b/two#20",
			card: cardB.id,
			option: "build",
		});
		assert.equal(answered.status, 200);
		assert.deepEqual(
			readJsonl("projects/beta/answers.jsonl").map((a) => [a.item, a.card]),
			[["b/two#20", cardB.id]],
		);
		assert.ok(!fs.existsSync(homePath("projects/alpha/answers.jsonl")));
		assert.deepEqual(kinds("alpha"), ["merge a/one#1"]);
		assert.deepEqual(kinds("beta"), ["answer b/two#20"]);
		assert.deepEqual(coordinators, [["beta", "answer"]]);
		const after = (await call(srv, "GET", "/api/inbox")).body.cards;
		assert.equal(after.find((c) => c.card.id === cardB.id).answer.option, "build");
		assert.equal(after.find((c) => c.card.id === cardA.id).answer, null);
	} finally {
		await srv.close();
	}
});

test("a task joins its own project's lock groups, never another's", () => {
	const config = configOf();
	const lockOf = (lock) =>
		parseTask("digest", `---\nproject: alpha\nlock: ${lock}\n---\nGo.\n`, config);
	assert.match(lockOf("beta.coordinator").error, /lock beta\.coordinator is another project's/);
	assert.equal(lockOf("alpha.coordinator").error, null);
	assert.equal(lockOf("shared-studio").error, null);
});

test("a run writes its own project's files only", () => {
	write("runs/act-1/status.json", { id: "act-1", kind: "act", project: "alpha", state: "done" });
	const as = (project, ...args) =>
		spawnSync(process.execPath, [BIN, ...args], {
			encoding: "utf8",
			env: { ...process.env, RUSUBAN_RUN: "act-1", RUSUBAN_PROJECT: project },
		});
	assert.match(
		as("beta", "log", "note", "-", "Hi").stderr,
		/run act-1 works for project alpha, not beta/,
	);
	assert.match(
		as("alpha", "log", "note", "b/two#20", "Hi").stderr,
		/b\/two is not a repo of this project/,
	);
	assert.equal(as("alpha", "log", "note", "-", "Hi").status, 0);
	assert.equal(readJsonl("projects/alpha/agent-log.jsonl").length, 1);
	assert.ok(!fs.existsSync(homePath("projects/beta")));
});

test("project add, list and remove, without a daemon", async () => {
	const ids = () => read("config.json").projects.map((p) => p.id);
	// The agents act on a repo added as its rules say: without a terminal, it waits for the owner's
	// card (FR-092).
	const allowed = async (...args) => {
		const asked = await cli("project", "add", ...args);
		assert.match(asked.stdout, /\nIt waits for your confirmation/, asked.stderr);
		const request = pendingRequests().at(-1);
		assert.equal(confirmRequest(request.id, { allow: true, by: "alice" }).state, "confirmed");
		return asked.stdout;
	};
	assert.deepEqual(
		JSON.parse((await cli("project", "list")).stdout).map((p) => p.id),
		["alpha", "beta"],
	);

	const added = await cli("project", "add", "c/three");
	assert.equal(added.status, 0, added.stderr);
	assert.match(added.stdout, /^Add c\/three as project three\?\nIt waits for your confirmation/);
	assert.deepEqual(ids(), ["alpha", "beta"], "nothing changes before the owner allows it");
	const [request] = pendingRequests();
	assert.deepEqual(
		[request.origin, request.change.kind, request.change.slug],
		["cli", "project.add", "c/three"],
	);
	assert.equal(confirmRequest(request.id, { allow: true, by: "alice" }).state, "confirmed");
	assert.deepEqual(ids(), ["alpha", "beta", "three"]);
	if (process.platform !== "win32")
		assert.equal(fs.statSync(homePath("config.json")).mode & 0o777, 0o600);

	assert.match(
		(await cli("project", "add", "C/Three")).stderr,
		/C\/Three is already in project three/,
	);
	assert.match(await allowed("d/three"), /^Add d\/three as project d-three\?/);
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-checkout-"));
	assert.match(
		await allowed("c/four", "--to", "three", "--checkout", folder),
		/^Add c\/four to three\?/,
	);
	assert.deepEqual(read("config.json").projects.find((p) => p.id === "three").repos, [
		{ slug: "c/three", checkout: null },
		{ slug: "c/four", checkout: path.resolve(folder) },
	]);
	assert.match((await cli("project", "add", "c/five", "--to", "nope")).stderr, /no project "nope"/);
	assert.match(
		(await cli("project", "add", "c/six", "--checkout", path.join(folder, "missing"))).stderr,
		/is not a folder/,
	);
	assert.match(
		(await cli("project", "add", "c/seven", "--force")).stderr,
		/Unknown option '--force'/,
	);
	assert.match((await cli("project", "add", "seven")).stderr, /seven is not owner\/repo/);
	assert.match((await cli("project", "mode", "three", "live")).stderr, /usage: project add/);

	// A run of the project that waits refuses the remove, which deletes nothing.
	write("runs/act-9/status.json", { id: "act-9", kind: "act", project: "three", state: "queued" });
	write("projects/three/journal.jsonl", {});
	fs.mkdirSync(homePath("tasks"), { recursive: true });
	fs.writeFileSync(homePath("tasks/t3.md"), "---\nproject: three\n---\nGo.\n");
	assert.match(
		(await cli("project", "remove", "three")).stderr,
		/runs that wait or work: act-9 \(queued\)/,
	);
	write("runs/act-9/status.json", { id: "act-9", kind: "act", project: "three", state: "done" });
	const removed = await cli("project", "remove", "three");
	assert.equal(removed.status, 0, removed.stderr);
	assert.match(removed.stdout, /^project three removed\.\n/);
	assert.match(removed.stdout, /Its files stay in:/);
	assert.ok(removed.stdout.includes(homePath("projects/three")));
	assert.match(removed.stdout, /Task t3 names it and will not run/);
	assert.ok(fs.existsSync(homePath("projects/three/journal.jsonl")));
	assert.deepEqual(ids(), ["alpha", "beta", "d-three"]);
	assert.match((await cli("project", "remove", "three")).stderr, /no project "three"/);
	assert.match((await cli("project")).stderr, /usage: project add/);
});

test("a running daemon applies project add and remove without a restart", async () => {
	const srv = await startServer({ port: 0, quiet: true, tailnet: null, deps });
	const said = [];
	srv.ctx.say = (...a) => said.push(a.join(" "));
	try {
		saveConfig(configOf({ port: srv.port })); // so the commands find this daemon
		// Asked without a terminal, a new project waits for the owner, who allows it on the card.
		const added = await cli("project", "add", "c/three");
		assert.match(added.stdout, /It waits for your confirmation/);
		const card = (await call(srv, "GET", "/api/inbox")).body.cards.find(
			(c) => c.type === "setting",
		);
		assert.deepEqual(
			[card.project, card.card.options.map((o) => o.label)],
			["three", ["Allow it", "Don't allow it"]],
		);
		const allowed = await call(srv, "POST", "/api/answer", {
			project: "three",
			item: null,
			card: card.card.id,
			option: "allow",
		});
		assert.deepEqual([allowed.status, allowed.body.state], [200, "confirmed"]);
		await until(() => reads.includes("three"));
		assert.ok(srv.ctx.loops.get("three"));
		assert.deepEqual(
			readJsonl("settings.jsonl").map((e) => [e.setting, e.origin, e.state]),
			[
				["project.add", "cli", "pending"],
				["project.add", "cli", "confirmed"],
			],
		);

		const removed = await cli("project", "remove", "three");
		assert.match(removed.stdout, /The running daemon applied it\./);
		assert.deepEqual([...srv.ctx.loops.keys()].sort(), ["alpha", "beta"]);
		assert.ok(fs.existsSync(homePath("projects/three/live.json")));

		// A config that does not load leaves the running one.
		fs.writeFileSync(homePath("config.json"), "{ not json");
		reloadConfig(srv.ctx);
		assert.deepEqual(
			srv.ctx.config.projects.map((p) => p.id),
			["alpha", "beta"],
		);
		assert.match(said.at(-1), /config\.json changed but is not applied/);
	} finally {
		await srv.close();
	}
});

test("a project without a repo is created at once, and the daemon reads nothing on GitHub for it", async () => {
	const srv = await startServer({ port: 0, quiet: true, tailnet: null, deps });
	try {
		saveConfig(configOf({ port: srv.port })); // so the command finds this daemon
		const made = await cli("project", "create", "posts", "--title", "Posts");
		assert.equal(made.status, 0, made.stderr);
		assert.match(made.stdout, /^project posts added, without a repo: /);
		assert.match(made.stdout, /The running daemon applied it\./);
		assert.match((await cli("project", "create", "posts")).stderr, /project posts exists already/);
		assert.match((await cli("project", "create", "Posts!")).stderr, /is not a project id/);
		assert.equal(srv.ctx.loops.has("posts"), false);
		const { body } = await call(srv, "GET", "/api/state?project=posts");
		assert.deepEqual(
			[body.project.title, body.project.repos, body.project.observeOnly, body.freshness],
			["Posts", [], false, null],
		);
		assert.ok(!reads.includes("posts"), "nothing is read on GitHub");
	} finally {
		await srv.close();
	}
});
