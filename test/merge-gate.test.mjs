// One breaking test per hard lock (FR-021, FR-022): from a PR that would merge, each case breaks one
// lock, and the PR must lose its eligibility to exactly the gate that guards that lock.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { gatesOf, isEligible } from "../src/model.mjs";

const HEAD = "abc123";
const file = (path, additions = 10, change = "MODIFIED") => ({
	path,
	additions,
	deletions: 0,
	change,
});
const check = (name, workflow, state = "success") => ({ name, workflow, state });

// A PR that would merge: CI green with its required checks, reviewed, no thread, rebaseable, judged
// mergeable alone on its head, within the project's locks, merges armed.
const mergeable = () => ({
	pr: {
		repo: "o/r",
		n: 1,
		title: "Fix the parser",
		url: "",
		author: "a",
		draft: false,
		head: HEAD,
		base: "main",
		files: [file("src/parser.js")],
		filesTruncated: false,
		refs: [],
		closes: [],
		mergeable: "MERGEABLE",
		canBeRebased: true,
		ci: { state: "success", runId: null, runIds: [], waiting: [] },
		checks: [check("test", "CI"), check("CodeRabbit", null)],
		reviews: { coderabbitai: "COMMENTED" },
		threadsOpen: 0,
	},
	j: { type: "pr", kind: "bug", owner: "agent", pr: { head: HEAD, auto: true, why: "small fix" } },
	opts: {
		armed: true,
		rules: {
			observeOnly: false,
			errors: [],
			locks: {
				mergeMethod: "rebase",
				lockedPaths: [".github/**"],
				maxLines: 300,
				maxFiles: 15,
				requiredChecks: ["CI", "CodeRabbit"],
				requiredReviewers: ["coderabbitai"],
				evidence: [{ paths: ["engine/**"], what: "a benchmark" }],
			},
		},
	},
});

const stoppedBy = ({ pr, j, opts }) =>
	gatesOf(pr, j, opts)
		.filter((g) => g.state !== "ok" && g.state !== "na")
		.map((g) => g.name);

test("the baseline merges", () => {
	const c = mergeable();
	assert.ok(isEligible(gatesOf(c.pr, c.j, c.opts)));
});

const CASES = [
	// Built-in locks (FR-021)
	["an open review thread", "Threads", (c) => (c.pr.threadsOpen = 1)],
	["merges paused", "Switch", (c) => (c.opts.armed = false)],
	["a conflict", "Mergeable", (c) => (c.pr.mergeable = "CONFLICTING")],
	["mergeability not computed yet", "Mergeable", (c) => (c.pr.mergeable = "UNKNOWN")],
	["not rebaseable for a rebase merge", "Mergeable", (c) => (c.pr.canBeRebased = false)],
	["a draft", "Mergeable", (c) => (c.pr.draft = true)],
	["no check at all", "CI", (c) => (c.pr.checks = [])],
	["a missing required check", "CI", (c) => c.pr.checks.pop()],
	["a required check skipped", "CI", (c) => (c.pr.checks[1].state = "skipped")],
	["a check still running", "CI", (c) => (c.pr.checks[0].state = "pending")],
	[
		"a failed, cancelled or timed out check",
		"CI",
		(c) => c.pr.checks.push(check("e2e", "E2E", "failure")),
	],
	[
		"a fork workflow waiting for approval",
		"CI",
		(c) => (c.pr.ci = { state: "action_required", runId: 7, runIds: [7], waiting: ["Notify"] }),
	],
	["a check waiting for approval", "CI", (c) => c.pr.checks.push(check("deploy", "CD", "waiting"))],
	["a head moved since the judgment", "Judgment", (c) => (c.pr.head = "def456")],
	["no judgment", "Judgment", (c) => (c.j = undefined)],
	["judged not to merge alone", "Judgment", (c) => (c.j.pr.auto = false)],
	["a repo without rules", "Judgment", (c) => (c.opts.rules.observeOnly = true)],
	["the rules folder changed", "Locks", (c) => c.pr.files.push(file(".rusuban/rules/merge.md", 1))],
	["a renamed file", "Locks", (c) => c.pr.files.push(file("src/old.js", 0, "RENAMED"))],
	["more files than GitHub lists", "Locks", (c) => (c.pr.filesTruncated = true)],
	["changes requested", "Reviews", (c) => (c.pr.reviews.bob = "CHANGES_REQUESTED")],
	// Project locks (FR-022)
	["a locked path", "Locks", (c) => c.pr.files.push(file(".github/workflows/ci.yml", 1))],
	["too many lines", "Locks", (c) => (c.pr.files = [file("src/parser.js", 301)])],
	[
		"too many files",
		"Locks",
		(c) => (c.pr.files = Array.from({ length: 16 }, (_, i) => file(`src/f${i}.js`, 1))),
	],
	["a required reviewer missing", "Reviews", (c) => (c.pr.reviews = {})],
	["a proof missing", "Evidence", (c) => c.pr.files.push(file("engine/core.rs", 1))],
	[
		"a broken locks file",
		"Locks",
		(c) => (c.opts.rules = { observeOnly: false, locks: null, errors: ["locks.json: maxLines"] }),
	],
];

for (const [lock, gate, breakIt] of CASES)
	test(`one broken lock stops the merge: ${lock}`, () => {
		const c = mergeable();
		breakIt(c);
		assert.ok(!isEligible(gatesOf(c.pr, c.j, c.opts)));
		assert.deepEqual(stoppedBy(c), [gate]);
	});

// A head whose only checks are ignored is not green (T114): ignoredChecks can never empty CI.
test("one broken lock stops the merge: only ignored checks on the head", () => {
	const c = mergeable();
	c.opts.rules.locks.ignoredChecks = ["test", "CodeRabbit"];
	c.opts.rules.locks.requiredChecks = [];
	assert.ok(!isEligible(gatesOf(c.pr, c.j, c.opts)));
	assert.deepEqual(stoppedBy(c), ["CI"]);
	c.opts.rules.locks.ignoredChecks = ["CodeRabbit"];
	assert.ok(isEligible(gatesOf(c.pr, c.j, c.opts)), "one counting check left: green");
});

// Adversarial PRs (T032, SC-005): none is eligible, each stopped by the gate its fixture names.
const FIXTURES = new URL("./fixtures/prs/", import.meta.url);
for (const name of fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json")))
	test(`an adversarial PR is never merged: ${name}`, () => {
		const f = JSON.parse(fs.readFileSync(new URL(name, FIXTURES), "utf8"));
		const c = mergeable();
		Object.assign(c.pr, { body: f.body }, f.set);
		if (f.judged === "manual") c.j.pr.auto = false;
		assert.ok(!isEligible(gatesOf(c.pr, c.j, c.opts)), f.why);
		assert.deepEqual(stoppedBy(c), [f.stoppedBy], f.why);
	});
