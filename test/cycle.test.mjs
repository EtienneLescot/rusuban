// The daemon's cycle after each GitHub read, with GitHub and the agents replaced by recorders: what
// it merges, what it flags, which agents it starts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { append, read, readJsonl, write } from "../src/home.mjs";
import { journalRules, runCycle } from "../src/server.mjs";

const REPO = "o/r";
const pr = (n, over = {}) => ({
	repo: REPO,
	n,
	title: `PR ${n}`,
	url: `https://github.com/o/r/pull/${n}`,
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
	...over,
});
const auto = (n, over = {}) => ({
	type: "pr",
	label: `Fix ${n}`,
	kind: "bug",
	owner: "agent",
	next: "Merges.",
	revisitAt: "2099-01-01T00:00:00Z",
	pr: { head: `sha${n}`, auto: true, why: "A fix" },
	...over,
});
const RULES = {
	[REPO]: {
		observeOnly: false,
		ref: "main",
		treeSha: "t1",
		files: [{ name: "01.md", text: "Fixes merge alone." }],
		locks: { mergeMethod: "squash", lockedPaths: [".github/**"] },
		errors: [],
	},
};
const project = () => ({ id: "demo", title: "Demo", repos: [{ slug: REPO }] });
const liveOf = (prs, extra = {}) => ({
	repos: { [REPO]: { defaultBranch: "main", prs, issues: [], merged: [], pushes: [], ...extra } },
});

let merged;
let runs;
let coordinators;
let deps;
const ctxOf = (over = {}) => ({
	dry: false,
	mergeFailed: new Map(),
	loops: new Map(),
	say: () => {},
	config: { owner: { login: "alice" }, model: "claude-test" },
	...over,
});
const journal = () => readJsonl("projects/demo/journal.jsonl");

beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-cycle-"));
	merged = [];
	runs = [];
	coordinators = [];
	deps = {
		merge: async (a) => merged.push(a),
		requestRun: (o) => {
			runs.push(o);
			return { id: `run-${runs.length}` };
		},
		requestCoordinator: (_project, trigger) => {
			coordinators.push(trigger);
			return { id: `act-${coordinators.length}` };
		},
	};
	write("automerge.json", { armed: true });
});

test("the server merges one eligible PR per cycle, judged auto on its head, and journals its gates", async () => {
	const live = liveOf([pr(1, { ci: { state: "failure" }, checks: [] }), pr(2), pr(3)]);
	write("projects/demo/judgment.json", {
		items: { "o/r#1": auto(1), "o/r#2": auto(2), "o/r#3": auto(3) },
	});
	await runCycle(ctxOf(), project(), live, RULES, deps);
	assert.deepEqual(merged, [{ slug: REPO, n: 2, method: "squash", head: "sha2", admin: false }]);
	const [entry] = journal().filter((e) => e.kind === "merge");
	assert.deepEqual(
		[entry.item, entry.by, entry.head, entry.method],
		["o/r#2", "server", "sha2", "squash"],
	);
	assert.match(entry.text, /^Merged alone: Fix 2\. Every gate green on sha2/);
	assert.ok(entry.gates.includes("CI: CI green on the head") && entry.gates.length === 8);
});

test("nothing merges when paused, not even a person's order; armed again, it does", async () => {
	const live = liveOf([
		pr(1),
		pr(2, { files: [{ path: ".github/x.yml", additions: 1, deletions: 0, change: "MODIFIED" }] }),
	]);
	const card = {
		id: "o/r#2@1",
		head: "sha2",
		to: "alice",
		q: "Merge the workflow change?",
		createdAt: "2026-11-07T10:00:00Z",
		resolvedAt: null,
		options: [
			{ id: "merge", label: "Merge it", effect: "The server merges it.", merge: true },
			{ id: "no", label: "Leave it", effect: "I leave it." },
		],
	};
	const judged = auto(2, { owner: "alice", pr: { head: "sha2", auto: false }, decision: card });
	write("projects/demo/judgment.json", { items: { "o/r#1": auto(1), "o/r#2": judged } });
	write("automerge.json", { armed: false });
	await runCycle(ctxOf(), project(), live, RULES, deps);
	assert.deepEqual(merged, [], "paused: nothing merges alone");
	append("projects/demo/answers.jsonl", {
		at: "2026-11-07T11:00:00Z",
		item: "o/r#2",
		card: card.id,
		option: "merge",
		by: "alice",
	});
	await runCycle(ctxOf(), project(), live, RULES, deps);
	assert.deepEqual(merged, [], "paused: the order waits");
	write("automerge.json", { armed: true });
	write("projects/demo/judgment.json", { items: { "o/r#2": judged } });
	await runCycle(ctxOf(), project(), live, RULES, deps);
	assert.deepEqual(merged, [{ slug: REPO, n: 2, method: "squash", head: "sha2", admin: false }]);
	const entry = journal().find((e) => e.kind === "merge");
	assert.deepEqual(
		[entry.card, entry.text.startsWith("Merged on @alice's order")],
		[card.id, true],
	);
	assert.ok(coordinators.includes("merge"), "the coordinator closes the card");
});

test("a merge GitHub refuses is journaled for the owner and not tried again on that head", async () => {
	const live = liveOf([pr(1)]);
	write("projects/demo/judgment.json", { items: { "o/r#1": auto(1) } });
	deps.merge = async (a) => {
		merged.push(a);
		throw Object.assign(new Error("x"), { stderr: "Base branch was modified" });
	};
	const ctx = ctxOf();
	await runCycle(ctx, project(), live, RULES, deps);
	await runCycle(ctx, project(), live, RULES, deps);
	assert.equal(merged.length, 1);
	const refused = journal().find((e) => e.kind === "merge-refused");
	assert.deepEqual(
		[refused.notify, refused.text],
		[true, "GitHub refused the merge of sha1: Base branch was modified"],
	);
});

test("merges and pushes the server did not make are flagged once, from the project's first watch on", async () => {
	write("projects/demo/flags.json", { since: "2026-11-07T00:00:00Z", seen: {} });
	append("projects/demo/journal.jsonl", { kind: "merge", item: "o/r#3", by: "server" });
	const m = (n, mergedAt, mergedBy = "bob") => ({
		repo: REPO,
		n,
		title: `PR ${n}`,
		url: "",
		mergedAt,
		mergedBy,
	});
	const live = liveOf([], {
		merged: [
			m(1, "2026-11-07T09:00:00Z"),
			m(2, "2026-11-06T09:00:00Z"),
			m(3, "2026-11-07T09:30:00Z"),
		],
		pushes: [
			{
				oid: "abcdef1234",
				url: "u",
				at: "2026-11-07T08:00:00Z",
				headline: "hotfix",
				author: "bob",
			},
			{ oid: "0123456789", url: "u", at: "2026-11-06T08:00:00Z", headline: "old", author: "bob" },
		],
	});
	await runCycle(ctxOf(), project(), live, RULES, deps);
	await runCycle(ctxOf(), project(), live, RULES, deps);
	const flags = journal().filter((e) => e.notify);
	assert.deepEqual(
		flags.map((e) => [e.kind, e.item]),
		[
			["foreign-merge", "o/r#1"],
			["direct-push", null],
		],
	);
	assert.match(
		flags[1].text,
		/^Pushed straight to main of o\/r by bob, outside any PR: hotfix \(abcdef1\)/,
	);
});

test("a first watch flags nothing from before it", async () => {
	const live = liveOf([], {
		merged: [{ repo: REPO, n: 1, title: "x", url: "", mergedAt: "2026-11-01T00:00:00Z" }],
	});
	await runCycle(ctxOf(), project(), live, RULES, deps);
	assert.deepEqual(journal(), []);
	assert.ok(read("projects/demo/flags.json").since);
});

test("agents start on change: a judge when the todo changes, a coordinator when reports wait", async () => {
	const live = liveOf([pr(1), pr(2)]);
	// Without a model no run starts (FR-098): nothing is asked for, nothing piles up.
	await runCycle(ctxOf({ config: { owner: { login: "alice" } } }), project(), live, RULES, deps);
	assert.deepEqual([runs, coordinators], [[], []]);
	await runCycle(ctxOf(), project(), live, RULES, deps);
	assert.deepEqual(
		runs.map((r) => [r.kind, r.lock, r.trigger, r.items]),
		[["judge", "demo.coordinator", "change", ["o/r#1", "o/r#2"]]],
	);
	await runCycle(ctxOf(), project(), live, RULES, deps);
	assert.equal(runs.length, 1, "the same todo starts nothing twice");
	await runCycle(ctxOf(), project(), liveOf([pr(1), pr(2), pr(3)]), RULES, deps);
	assert.equal(runs.length, 2, "a new PR changes the todo");
	assert.deepEqual(coordinators, []);
	append("projects/demo/reports.jsonl", {
		run: "w-1",
		worker: "fix",
		item: "o/r#1",
		state: "done",
		text: "PR opened",
	});
	await runCycle(ctxOf(), project(), liveOf([pr(1), pr(2), pr(3)]), RULES, deps);
	assert.deepEqual(coordinators, ["change"]);
});

test("a fork's CI waiting for an approval starts one judge per head, not one per change", async () => {
	const ci = { state: "action_required", runId: 7, runIds: [7], waiting: ["CI"] };
	const fork = (head = "sha1") => pr(1, { head, ci });
	const judged = (n) => auto(n, { pr: { head: `sha${n}`, auto: false } });
	const ended = (id) => write(`runs/${id}/status.json`, { id, project: "demo", state: "done" });
	write("projects/demo/judgment.json", { items: { "o/r#1": judged(1) } });
	await runCycle(ctxOf(), project(), liveOf([fork()]), RULES, deps);
	assert.deepEqual(runs.at(-1).items, ["o/r#1"]);
	ended("run-1");
	await runCycle(ctxOf(), project(), liveOf([fork(), pr(2)]), RULES, deps);
	assert.deepEqual(runs.at(-1).items, ["o/r#2"], "the approval examined is not handed out again");
	ended("run-2");
	write("projects/demo/judgment.json", { items: { "o/r#1": judged(1), "o/r#2": judged(2) } });
	await runCycle(ctxOf(), project(), liveOf([fork(), pr(2)]), RULES, deps);
	assert.equal(runs.length, 2, "nothing left but the approval examined on this head");
	await runCycle(ctxOf(), project(), liveOf([fork("sha1b"), pr(2)]), RULES, deps);
	assert.deepEqual(runs.at(-1).items, ["o/r#1"], "a new head is examined again");
});

test("a project without rules and a dry daemon start nothing", async () => {
	const observe = { [REPO]: { ...RULES[REPO], observeOnly: true, files: [] } };
	await runCycle(ctxOf(), project(), liveOf([pr(1)]), observe, deps);
	write("projects/demo/judgment.json", { items: { "o/r#1": auto(1) } });
	await runCycle(ctxOf({ dry: true }), project(), liveOf([pr(1), pr(2)]), RULES, deps);
	assert.deepEqual([runs, merged, coordinators], [[], [], []]);
});

test("a rules change is journaled with its diff for the owner; so is an invalid locks.json on first read", () => {
	const v1 = { ...RULES[REPO] };
	const v2 = {
		...v1,
		treeSha: "t2",
		files: [{ name: "01.md", text: "Fixes and docs merge alone." }],
	};
	journalRules("demo", REPO, undefined, v1);
	journalRules("demo", REPO, v1, { ...v1 });
	journalRules("demo", REPO, v1, v2);
	const bad = { ...v1, treeSha: "t3", locks: null, errors: ["locks.json is not valid JSON: x"] };
	journalRules("demo", "o/other", undefined, bad);
	const entries = journal();
	assert.deepEqual(
		entries.map((e) => [e.kind, e.notify]),
		[
			["rules", true],
			["locks-invalid", true],
		],
	);
	assert.match(
		entries[0].text,
		/^Rules of o\/r changed: rules\/01.md edited\. They apply from now on\./,
	);
	assert.match(entries[0].diff, /- Fixes merge alone\.\n\+ Fixes and docs merge alone\./);
	assert.match(entries[1].text, /nothing merges in o\/other until it is fixed/);
});

test("no second coordinator while one is at work: it takes what is new when it ends", async () => {
	write("runs/act-1/status.json", {
		id: "act-1",
		kind: "act",
		project: "demo",
		state: "running",
		pid: process.pid,
		createdAt: "2026-11-07T10:00:00Z",
	});
	append("projects/demo/reports.jsonl", {
		run: "w-1",
		worker: "fix",
		item: "o/r#1",
		state: "done",
		text: "ok",
	});
	await runCycle(ctxOf(), project(), liveOf([]), RULES, deps);
	assert.deepEqual(coordinators, []);
});
