import "./tmp-root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	bodyRefs,
	checksOf,
	ciOf,
	nextDelay,
	normalizePr,
	pushesOf,
	readProject,
	reviewsOf,
} from "../src/github.mjs";

const run = (name, workflow, status, conclusion) => ({
	__typename: "CheckRun",
	name,
	status,
	conclusion,
	checkSuite: { workflowRun: workflow ? { workflow: { name: workflow } } : null },
});

test("checks: runs carry their workflow, statuses their context", () => {
	const checks = checksOf([
		run("test", "CI", "COMPLETED", "SUCCESS"),
		run("lint", "CI", "IN_PROGRESS", null),
		{ __typename: "StatusContext", context: "CodeRabbit", state: "SUCCESS" },
	]);
	assert.deepEqual(
		checks.map((c) => `${c.workflow}/${c.name}:${c.state}`),
		["CI/test:success", "CI/lint:pending", "null/CodeRabbit:success"],
	);
});

test("check states as FR-021 reads them: only success, neutral and skipped pass", () => {
	const state = (status, conclusion) => checksOf([run("x", "CI", status, conclusion)])[0].state;
	assert.equal(state("COMPLETED", "SUCCESS"), "success");
	assert.equal(state("COMPLETED", "NEUTRAL"), "skipped");
	assert.equal(state("COMPLETED", "SKIPPED"), "skipped");
	for (const c of ["FAILURE", "CANCELLED", "TIMED_OUT", "STALE", "STARTUP_FAILURE"])
		assert.equal(state("COMPLETED", c), "failure", c);
	assert.equal(state("COMPLETED", "ACTION_REQUIRED"), "waiting");
	assert.equal(state("WAITING", null), "waiting");
	for (const s of ["QUEUED", "IN_PROGRESS", "PENDING", "REQUESTED"])
		assert.equal(state(s, null), "pending");
	const status = (s) =>
		checksOf([{ __typename: "StatusContext", context: "x", state: s }])[0].state;
	assert.deepEqual(["SUCCESS", "PENDING", "EXPECTED", "FAILURE", "ERROR"].map(status), [
		"success",
		"pending",
		"pending",
		"failure",
		"failure",
	]);
	const ci = (...checks) => ciOf(checksOf(checks), []).state;
	assert.equal(ci(), "none");
	assert.equal(ci(run("x", "CI", "COMPLETED", "SKIPPED")), "success");
	assert.equal(ci(run("x", "CI", "COMPLETED", "TIMED_OUT")), "failure");
	assert.equal(ci(run("x", "CI", "WAITING", null)), "pending");
});

test("a fork's workflow awaiting approval wins over a green rollup, and is named", () => {
	const suites = [
		{
			status: "COMPLETED",
			conclusion: "SUCCESS",
			workflowRun: { databaseId: 1, workflow: { name: "CI" } },
		},
		{
			status: "COMPLETED",
			conclusion: "ACTION_REQUIRED",
			workflowRun: { databaseId: 7, workflow: { name: "Diagnostics" } },
		},
	];
	const ci = ciOf(checksOf([run("test", "CI", "COMPLETED", "SUCCESS")]), suites);
	assert.deepEqual([ci.state, ci.runId, ci.waiting], ["action_required", 7, ["Diagnostics"]]);
});

test("only reviews of the head commit count, the latest per reviewer", () => {
	const nodes = [
		{ author: { login: "bob" }, state: "CHANGES_REQUESTED", commit: { oid: "old" } },
		{ author: { login: "ann" }, state: "COMMENTED", commit: { oid: "head" } },
		{ author: { login: "ann" }, state: "APPROVED", commit: { oid: "head" } },
	];
	assert.deepEqual(reviewsOf(nodes, "head"), { ann: "APPROVED" });
});

test("cited issues come from the description, not from HTML comments", () => {
	assert.deepEqual(bodyRefs("Fixes #12, refs #13\n<!-- closes #99 -->"), [12, 13]);
});

test("a PR with unseen files or threads is read the safe way", () => {
	const pr = normalizePr("o/r", {
		number: 5,
		body: "",
		isDraft: false,
		changedFiles: 140,
		headRefOid: "h",
		author: null,
		files: { nodes: [{ path: "a.js", additions: 1, deletions: 0 }] },
		reviewThreads: {
			totalCount: 103,
			nodes: Array.from({ length: 100 }, () => ({ isResolved: true })),
		},
		reviews: { nodes: [] },
		closingIssuesReferences: {
			nodes: [
				{ number: 4, repository: { nameWithOwner: "fork/r" } },
				{ number: 3, repository: { nameWithOwner: "o/r" } },
			],
		},
		commits: { nodes: [] },
	});
	assert.equal(pr.filesTruncated, true);
	assert.equal(pr.threadsOpen, 3);
	assert.deepEqual(pr.closes, [3]);
	assert.equal(pr.repo, "o/r");
	// Its head lives on no repo GitHub still knows: its fork was deleted.
	assert.equal(pr.headRepo, null);
	const fork = normalizePr("o/r", {
		...{ number: 6, body: "", changedFiles: 0, headRefName: "main", author: null },
		...{
			files: { nodes: [] },
			reviewThreads: { totalCount: 0, nodes: [] },
			reviews: { nodes: [] },
		},
		...{ closingIssuesReferences: { nodes: [] }, commits: { nodes: [] } },
		headRepository: { nameWithOwner: "bob/r" },
	});
	assert.deepEqual([fork.headRepo, fork.headRef], ["bob/r", "main"]);
});

test("polling slows down under 20 % of the rate-limit budget", () => {
	assert.equal(nextDelay(90, { remaining: 4000, limit: 5000 }), 90_000);
	assert.equal(nextDelay(90, { remaining: 900, limit: 5000 }), 360_000);
	assert.equal(nextDelay(90, null), 90_000);
});

test("a repo that fails keeps its last good state; changedAt moves only on change", async () => {
	const project = { repos: [{ slug: "o/a" }, { slug: "o/b" }] };
	const data = { prs: [{ n: 1 }], issues: [], merged: [] };
	const first = await readProject(project, null, async () => ({
		...data,
		rate: { remaining: 10, limit: 5000 },
	}));
	const second = await readProject(project, first, async (slug) => {
		if (slug === "o/b") throw new Error("HTTP 502\ndetails");
		return data;
	});
	assert.equal(second.repos["o/a"].changedAt, first.repos["o/a"].changedAt);
	assert.deepEqual(second.repos["o/b"].prs, [{ n: 1 }]);
	assert.equal(second.repos["o/b"].error, "HTTP 502");
	assert.equal(first.rate.remaining, 10);
});

test("a commit on the default branch from no merged PR was pushed straight to it", () => {
	const commit = (oid, prs) => ({
		oid,
		url: `https://github.com/o/r/commit/${oid}`,
		committedDate: "2026-11-07T10:00:00Z",
		messageHeadline: `commit ${oid}`,
		author: { name: "Bob", user: oid === "c3" ? null : { login: "bob" } },
		associatedPullRequests: { nodes: prs },
	});
	const pushes = pushesOf([
		commit("c1", [{ number: 4, merged: true }]),
		commit("c2", []),
		commit("c3", [{ number: 5, merged: false }]),
	]);
	assert.deepEqual(
		pushes.map((p) => [p.oid, p.author]),
		[
			["c2", "bob"],
			["c3", "Bob"],
		],
	);
});
