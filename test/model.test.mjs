import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildModel,
	edgesOf,
	gatesOf,
	globToRegExp,
	H,
	isEligible,
	settledOf,
	todoOf,
	W,
} from "../src/model.mjs";

const REPO = "o/r";
const pr = (n, over = {}) => ({
	repo: REPO,
	n,
	title: `PR ${n}`,
	url: "",
	author: "a",
	draft: false,
	head: `sha${n}`,
	base: "main",
	files: [{ path: "src/lib/foo.js", additions: 10, deletions: 2, change: "MODIFIED" }],
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
const issue = (n, repo = REPO) => ({ repo, n, title: `Issue ${n}`, url: "", author: "r" });
const future = "2099-01-01T00:00:00.000Z";
const fix = (n, over = {}) => ({
	type: "pr",
	kind: "bug",
	owner: "agent",
	pr: { head: `sha${n}`, auto: true, why: "ok" },
	revisitAt: future,
	judgedAt: new Date().toISOString(),
	...over,
});
const LOCKS = {
	lockedPaths: [".github/**", "package-lock.json"],
	maxLines: 300,
	maxFiles: 15,
	sizeExempt: ["**/*.test.*", "docs/**", "*.md"],
	evidence: [{ paths: ["crates/compositor/**"], what: "a pixel-identical export" }],
};
const RULES = { observeOnly: false, locks: LOCKS, errors: [] };
const gates = (p, j, rules = RULES, armed = true) => gatesOf(p, j, { rules, armed });
const by = (g, name) => g.find((x) => x.name === name);
const states = (g) => g.map((x) => x.state).join(",");
const file = (path, additions = 1, change = "MODIFIED") => ({
	path,
	additions,
	deletions: 0,
	change,
});

test("a judged PR with every gate green is eligible", () => {
	const g = gates(pr(1), fix(1));
	assert.equal(
		g.map((x) => x.name).join(","),
		"CI,Reviews,Threads,Mergeable,Judgment,Locks,Evidence,Switch",
	);
	assert.equal(states(g), "ok,na,ok,ok,ok,ok,na,ok");
	assert.ok(isEligible(g));
});

test("a new commit invalidates the judgment", () => {
	const g = gates(pr(1, { head: "other" }), fix(1));
	assert.equal(by(g, "Judgment").state, "todo");
	assert.ok(!isEligible(g));
});

test("the merge switch, observe-only repos and unloaded rules keep every merge shut", () => {
	assert.equal(by(gates(pr(1), fix(1), RULES, false), "Switch").state, "fail");
	assert.match(by(gates(pr(1), fix(1), { observeOnly: true }), "Judgment").detail, /Observe only/);
	assert.equal(by(gatesOf(pr(1), fix(1), { armed: true }), "Judgment").state, "fail");
});

test("locks block whatever the judgment says: .rusuban/, locked paths, renames, unseen files, a broken locks file", () => {
	const locks = (p, rules = RULES) => by(gates(p, fix(1), rules), "Locks");
	assert.equal(
		locks(pr(1, { files: [file(".rusuban/rules/a.md")] }), { observeOnly: false }).state,
		"fail",
	);
	assert.equal(locks(pr(1, { files: [file(".github/workflows/ci.yml")] })).state, "fail");
	assert.equal(locks(pr(1, { files: [file("web/package-lock.json")] })).state, "fail");
	assert.equal(locks(pr(1, { files: [file("notes/a.txt", 1, "RENAMED")] })).state, "fail");
	assert.equal(locks(pr(1, { filesTruncated: true })).state, "fail");
	assert.match(
		locks(pr(1), {
			observeOnly: false,
			locks: null,
			errors: ["locks.json: maxLines must be a positive integer"],
		}).detail,
		/Invalid locks/,
	);
});

test("size counts code, not exempt tests or docs", () => {
	assert.equal(by(gates(pr(1, { files: [file("src/a.js", 310)] }), fix(1)), "Locks").state, "fail");
	const mixed = [
		file("src/a.js", 20),
		file("src/a.test.js", 900),
		file("docs/x.txt", 400),
		file("README.md", 50),
	];
	assert.equal(by(gates(pr(1, { files: mixed }), fix(1)), "Locks").state, "ok");
	assert.equal(
		by(gates(pr(1, { files: [file("src/a.js", 310)] }), fix(1), { observeOnly: false }), "Locks")
			.state,
		"ok",
	);
});

test("evidence paths need a proof recorded on the current head", () => {
	const files = [file("crates/compositor/src/scene.rs", 5)];
	assert.match(by(gates(pr(1, { files }), fix(1)), "Evidence").detail, /pixel-identical/);
	const proved = fix(1, {
		pr: { head: "sha1", auto: true, evidence: { state: "ok", head: "sha1" } },
	});
	assert.ok(isEligible(gates(pr(1, { files }), proved)));
	const old = fix(1, { pr: { head: "sha1", auto: true, evidence: { state: "ok", head: "old" } } });
	assert.equal(by(gates(pr(1, { files }), old), "Evidence").state, "todo");
	const asked = fix(1, {
		pr: { head: "sha1", auto: true, evidence: { needed: true, state: "running", head: "sha1" } },
	});
	assert.equal(by(gates(pr(1), asked), "Evidence").state, "wait");
});

test("fork CI awaiting approval, open threads, conflicts, drafts and rebases block", () => {
	const waiting = { state: "action_required", runId: 7, runIds: [7], waiting: ["CI"] };
	assert.equal(by(gates(pr(1, { ci: waiting }), fix(1)), "CI").state, "wait");
	assert.equal(by(gates(pr(1, { threadsOpen: 2 }), fix(1)), "Threads").state, "fail");
	assert.equal(by(gates(pr(1, { mergeable: "CONFLICTING" }), fix(1)), "Mergeable").state, "fail");
	assert.equal(by(gates(pr(1, { mergeable: "UNKNOWN" }), fix(1)), "Mergeable").state, "wait");
	assert.equal(by(gates(pr(1, { draft: true }), fix(1)), "Mergeable").state, "fail");
	assert.equal(by(gates(pr(1, { canBeRebased: false }), fix(1)), "Mergeable").state, "ok");
	const rebase = { ...RULES, locks: { ...LOCKS, mergeMethod: "rebase" } };
	assert.equal(
		by(gates(pr(1, { canBeRebased: false }), fix(1), rebase), "Mergeable").state,
		"fail",
	);
	assert.equal(
		by(gates(pr(1, { ci: { state: "none", runIds: [], waiting: [] }, checks: [] }), fix(1)), "CI")
			.state,
		"todo",
	);
});

test("requiredChecks narrow CI to the named checks or workflows", () => {
	const rules = (requiredChecks) => ({ ...RULES, locks: { ...LOCKS, requiredChecks } });
	const ci = (p, required) => by(gates(p, fix(1), rules(required)), "CI");
	const checks = [
		{ name: "test", workflow: "CI", state: "success" },
		{ name: "lint", workflow: "CI", state: "success" },
		{ name: "CodeRabbit", workflow: null, state: "success" },
		{ name: "nix build", workflow: "Nix", state: "failure" },
	];
	const notify = { state: "action_required", runId: 9, runIds: [9], waiting: ["Discord"] };
	assert.equal(ci(pr(1, { checks, ci: notify }), ["CI", "CodeRabbit"]).state, "ok");
	assert.equal(ci(pr(1, { checks, ci: { ...notify, waiting: ["CI"] } }), ["CI"]).state, "wait");
	assert.equal(ci(pr(1, { checks }), ["Nix"]).state, "fail");
	assert.match(ci(pr(1, { checks }), ["e2e"]).detail, /e2e has not run/);
	assert.equal(
		ci(pr(1, { checks, ci: { state: "failure", runIds: [], waiting: [] } }), []).state,
		"fail",
	);
});

test("required reviewers must review the head, and changes requested block", () => {
	const rules = { ...RULES, locks: { ...LOCKS, requiredReviewers: ["coderabbitai[bot]"] } };
	const rev = (reviews, r = rules) => by(gates(pr(1, { reviews }), fix(1), r), "Reviews");
	assert.equal(rev({}).state, "wait");
	assert.equal(rev({ coderabbitai: "COMMENTED" }).state, "ok");
	assert.equal(rev({ coderabbitai: "APPROVED", bob: "CHANGES_REQUESTED" }).state, "fail");
	assert.equal(rev({ bob: "CHANGES_REQUESTED" }, RULES).state, "fail");
});

test("globs: segments, depth and anchoring", () => {
	const m = (glob, path) => globToRegExp(glob).test(path);
	assert.ok(m(".github/**", ".github/workflows/ci.yml"));
	assert.ok(!m(".github/**", "src/.github/x"));
	assert.ok(m("package-lock.json", "a/b/package-lock.json"));
	assert.ok(m("**/*.test.*", "src/a.test.js") && m("**/*.test.*", "a.test.ts"));
	assert.ok(m("src/*.js", "src/a.js") && !m("src/*.js", "src/x/a.js"));
	assert.ok(m("/README.md", "README.md") && !m("/README.md", "docs/README.md"));
	assert.ok(m("docs/?.md", "docs/a.md") && !m("docs/?.md", "docs/ab.md"));
});

test("links: refs to open issues, ordering, duplicates, shared files without hubs", () => {
	const hub = file("electron/ipc/handlers.ts");
	const live = {
		issues: [issue(10), issue(11)],
		prs: [
			pr(1, { refs: [10, 999], files: [hub, file("a.ts")] }),
			pr(2, { files: [hub, file("a.ts")] }),
			pr(3, { files: [hub, file("b.ts")] }),
			pr(4, { files: [hub, file("b.ts")] }),
		],
	};
	const items = {
		"o/r#2": { links: { before: [1] } },
		"o/r#11": { links: { duplicateOf: "#10" } },
	};
	const kinds = edgesOf(live, items)
		.map((e) => `${e.kind}:${e.from}>${e.to}`)
		.sort();
	assert.deepEqual(kinds, [
		"addresses:o/r#10>o/r#1",
		"before:o/r#1>o/r#2",
		"duplicate:o/r#11>o/r#10",
		"files:o/r#4>o/r#3",
	]);
});

test("todo lists every reason, and skips observe-only repos", () => {
	const ci = { state: "action_required", runId: 7, runIds: [7], waiting: ["CI"] };
	const live = {
		prs: [pr(1), pr(2, { head: "new", ci }), pr(5, { repo: "o/quiet" })],
		issues: [issue(10), issue(11), issue(12), issue(13), issue(20, "o/quiet")],
	};
	const now = Date.parse("2026-11-05T12:00:00Z");
	const third = (revisitAt) => ({
		type: "issue",
		kind: "bug",
		owner: "third",
		waits: "the reporter",
		revisitAt,
	});
	const judgment = {
		items: {
			"o/r#2": fix(2),
			"o/r#11": { type: "issue", kind: "feature", owner: "alice" },
			"o/r#12": third("2026-11-05T11:00:00Z"),
			"o/r#13": third("2026-11-06T12:00:00Z"),
		},
	};
	const reasons = todoOf({ live, judgment, acting: new Set([REPO]), now })
		.map((t) => `${t.item}:${t.reason}`)
		.sort();
	assert.deepEqual(reasons, [
		"o/r#10:unjudged",
		"o/r#11:missing-card",
		"o/r#12:revisit-due",
		"o/r#1:unjudged",
		"o/r#2:ci-approval",
		"o/r#2:new-commit",
	]);
	assert.deepEqual(todoOf({ live, judgment, acting: new Set(), now }), []);
});

test("multi-repo: the same number in two repos is two items", () => {
	const live = { prs: [pr(1), pr(1, { repo: "o/b", head: "other" })], issues: [], merged: [] };
	const judgment = { items: { "o/r#1": fix(1) } };
	const todo = todoOf({ live, judgment, acting: new Set([REPO, "o/b"]) });
	assert.deepEqual(
		todo.map((t) => `${t.item}:${t.reason}`),
		["o/b#1:unjudged"],
	);
	const m = buildModel({ live, judgment, rules: { [REPO]: RULES, "o/b": RULES }, armed: true });
	assert.deepEqual(m.nodes.map((n) => n.id).sort(), ["o/b#1", "o/r#1"]);
	assert.deepEqual(
		[
			m.nodes.find((n) => n.id === "o/r#1").eligible,
			m.nodes.find((n) => n.id === "o/b#1").eligible,
		],
		[true, false],
	);
});

test("layout: no overlapping nodes, stable from one run to the next", () => {
	const issues = Array.from({ length: 30 }, (_, i) => issue(100 + i));
	const prs = Array.from({ length: 15 }, (_, i) =>
		pr(200 + i, { refs: i < 10 ? [100 + i] : [], files: [file(`f${i}.js`)] }),
	);
	const items = { "o/r#205": { links: { before: [204] } } };
	for (const is of issues.slice(20))
		items[`o/r#${is.n}`] = { type: "issue", kind: "feature", owner: "alice" };
	const input = { live: { prs, issues, merged: [] }, judgment: { items }, me: "alice" };
	const a = buildModel(input);
	for (let i = 0; i < a.nodes.length; i++)
		for (let j = i + 1; j < a.nodes.length; j++) {
			const [p, q] = [a.nodes[i], a.nodes[j]];
			assert.ok(Math.abs(p.x - q.x) >= W || Math.abs(p.y - q.y) >= H, `${p.id} overlaps ${q.id}`);
		}
	assert.deepEqual(
		buildModel(input).nodes.map((n) => [n.id, n.x, n.y]),
		a.nodes.map((n) => [n.id, n.x, n.y]),
	);
	const at = (id) => a.nodes.find((n) => n.id === id);
	assert.ok(at("o/r#205").x > at("o/r#204").x, "a PR that goes after sits to the right");
	assert.equal(a.counts.mine, 10);
	assert.ok(a.frames.some((f) => f.kind === "group" && f.group === "mine" && f.count === 10));
});

test("only PRs on the merge lane feed main, and a paused switch keeps them still", () => {
	const live = {
		prs: [pr(1), pr(2, { ci: { state: "pending", runIds: [], waiting: [] } }), pr(3)],
		issues: [],
		merged: [],
	};
	const judgment = {
		items: {
			"o/r#1": fix(1),
			"o/r#2": fix(2),
			"o/r#3": fix(3, { pr: { head: "sha3", auto: false } }),
		},
	};
	const rules = { [REPO]: RULES };
	const toMain = (m) =>
		m.edges
			.filter((e) => e.kind === "main")
			.map((e) => `${e.from}:${e.live}`)
			.sort();
	const armed = buildModel({ live, judgment, rules, armed: true });
	assert.deepEqual(toMain(armed), ["o/r#1:true", "o/r#2:false"]);
	assert.equal(armed.main.ready, 1);
	const paused = buildModel({ live, judgment, rules, armed: false });
	assert.deepEqual(toMain(paused), ["o/r#1:false", "o/r#2:false"]);
	assert.equal(paused.edges.find((e) => e.from === "o/r#1").label, "ready, merges paused");
});

test("a closed card stays visible for 48 h with the chosen option", () => {
	const now = Date.parse("2026-10-24T12:00:00Z");
	const d = {
		id: "c1",
		q: "Ship it?",
		options: [{ id: "yes", label: "Ship it" }],
		createdAt: "2026-10-24T10:00:00Z",
		resolvedAt: "2026-10-24T11:00:00Z",
		outcome: "Merged.",
		state: "resolved",
	};
	const s = settledOf(
		"o/r#1",
		{ decision: d },
		[{ item: "o/r#1", card: "c1", option: "yes", at: "2026-10-24T10:30:00Z" }],
		now,
	);
	assert.deepEqual([s.choice, s.outcome], ["Ship it", "Merged."]);
	assert.equal(settledOf("o/r#1", { decision: d }, [], now + 3 * 86400e3), null);
});

test("agents at work light the items they touch: a run's items, then the items it cites", () => {
	const live = { prs: [pr(1)], issues: [issue(10), issue(11)], merged: [] };
	const runs = [
		{
			id: "w",
			kind: "worker",
			title: "fix-10",
			state: "running",
			items: ["o/r#10"],
			startedAt: "2026-10-24T12:00:00Z",
		},
		{
			id: "j",
			kind: "judge",
			state: "running",
			items: [],
			focus: ["o/r#1", "o/r#10"],
			step: "reads the PR",
			startedAt: "2026-10-24T12:01:00Z",
		},
		{ id: "old", kind: "judge", state: "done", items: ["o/r#11"] },
	];
	const m = buildModel({ live, judgment: { items: {} }, runs });
	const at = Object.fromEntries(m.nodes.map((n) => [n.id, n.activity?.name ?? null]));
	assert.deepEqual(at, { "o/r#1": "judge", "o/r#10": "fix-10", "o/r#11": null });
});
