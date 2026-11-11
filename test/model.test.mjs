import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildModel,
	edgesOf,
	gatesOf,
	globToRegExp,
	H,
	isEligible,
	mergeOrdersOf,
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
	// Tests and docs under a zone change no behavior to prove: sizeExempt leaves them out.
	const tests = [
		file("crates/compositor/src/scene.test.rs", 5),
		file("crates/compositor/README.md"),
	];
	assert.equal(by(gates(pr(1, { files: tests }), fix(1)), "Evidence").state, "na");
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
	const method = (mergeMethod) => ({ ...RULES, locks: { ...LOCKS, mergeMethod } });
	const unrebasable = (rules) =>
		by(gates(pr(1, { canBeRebased: false }), fix(1), rules), "Mergeable");
	assert.equal(unrebasable(method("rebase")).state, "fail");
	assert.equal(unrebasable(method("squash")).state, "ok");
	// No method stated: the strictest, a rebase, is assumed.
	assert.equal(unrebasable(RULES).state, "fail");
	assert.equal(
		by(gates(pr(1, { ci: { state: "none", runIds: [], waiting: [] }, checks: [] }), fix(1)), "CI")
			.state,
		"todo",
	);
});

test("CI green is FR-021's: every check passes, and each required name has a success", () => {
	const rules = (requiredChecks) => ({ ...RULES, locks: { ...LOCKS, requiredChecks } });
	const ci = (checks, required = [], over = {}) =>
		by(gates(pr(1, { checks, ...over }), fix(1), rules(required)), "CI");
	const c = (name, workflow, state) => ({ name, workflow, state });
	const green = [
		c("test", "CI", "success"),
		c("lint", "CI", "skipped"),
		c("CodeRabbit", null, "success"),
	];
	assert.equal(ci(green, ["CI", "CodeRabbit"]).state, "ok");
	// Every check counts, not only the required ones.
	const nix = c("nix build", "Nix", "failure");
	assert.match(ci([...green, nix], ["CI", "CodeRabbit"]).detail, /CI failed: nix build/);
	assert.equal(ci([...green, c("nix build", "Nix", "pending")], ["CI"]).state, "wait");
	const notify = { state: "action_required", runId: 9, runIds: [9], waiting: ["Discord"] };
	assert.match(ci(green, ["CI"], { ci: notify }).detail, /Awaiting approval: Discord/);
	assert.match(ci([...green, c("deploy", "CD", "waiting")]).detail, /Awaiting approval: deploy/);
	// A required name must be there with a success: absent waits, skipped fails.
	assert.match(ci(green, ["e2e"]).detail, /Required but not run: e2e/);
	assert.match(ci(green, ["lint"]).detail, /Required but skipped: lint/);
	assert.equal(ci(green, ["lint"]).state, "fail");
	// No check at all is not green; checks that were all skipped are (FR-021 as written).
	assert.equal(ci([]).state, "todo");
	assert.equal(ci([c("docs", "Docs", "skipped")]).state, "ok");
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
	const reasons = todoOf({ live, judgment, rules: { [REPO]: RULES }, now })
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
	assert.deepEqual(todoOf({ live, judgment, rules: {}, now }), []);
	assert.deepEqual(todoOf({ live, judgment, rules: { [REPO]: { observeOnly: true } }, now }), []);
});

test("a fork's CI approval comes once per head", () => {
	const ci = { state: "action_required", runId: 7, runIds: [7], waiting: ["CI"] };
	const todo = (over) =>
		todoOf({
			live: { prs: [pr(1, { ci })], issues: [] },
			judgment: { items: { "o/r#1": fix(1) } },
			rules: { [REPO]: RULES },
			...over,
		}).map((t) => `${t.reason}@${t.head}`);
	assert.deepEqual(todo(), ["ci-approval@sha1"]);
	assert.deepEqual(todo({ examined: { "o/r#1": "sha1" } }), [], "examined on this head");
	assert.deepEqual(todo({ examined: { "o/r#1": "sha0" } }), ["ci-approval@sha1"], "a new head");
});

test("lock-blocked: a PR judged mergeable alone that a project lock stops", () => {
	const todo = (p, j, rules = RULES) =>
		todoOf({
			live: { prs: [p], issues: [] },
			judgment: { items: { [`${REPO}#1`]: j } },
			rules: { [REPO]: rules },
		});
	const locked = todo(pr(1, { files: [file(".github/workflows/ci.yml")] }), fix(1));
	assert.deepEqual(
		locked.map((t) => [t.reason, t.head, t.lock]),
		[["lock-blocked", "sha1", "Locks: Locked paths: .github/workflows/ci.yml"]],
	);
	assert.equal(todo(pr(1, { files: [file("src/a.js", 400)] }), fix(1))[0].reason, "lock-blocked");
	const proof = { needed: true, state: "fail", head: "sha1" };
	const impact = fix(1, { pr: { head: "sha1", auto: true, evidence: proof } });
	assert.match(todo(pr(1), impact)[0].lock, /^Evidence: The proof shows an impact/);
	// Not blocked by a lock: a card already open, judged not to merge alone, a proof still to make,
	// a broken locks file (fixed in the repo, not on a card per PR).
	const card = {
		...fix(1, { owner: "alice", revisitAt: undefined }),
		decision: { id: "c", q: "?", options: [], createdAt: "2026-11-07T00:00:00Z", resolvedAt: null },
	};
	assert.deepEqual(todo(pr(1, { files: [file(".github/x.yml")] }), card), []);
	const manual = fix(1, { pr: { head: "sha1", auto: false } });
	assert.deepEqual(todo(pr(1, { files: [file(".github/x.yml")] }), manual), []);
	assert.deepEqual(todo(pr(1, { files: [file("crates/compositor/a.rs")] }), fix(1)), []);
	const broken = { observeOnly: false, locks: null, errors: ["locks.json: bad"] };
	assert.deepEqual(todo(pr(1), fix(1), broken), []);
});

test("a PR that changes .rusuban/ is a person's: out of the todo, the graph and its links", () => {
	const rulesPr = pr(2, {
		files: [file("src/a.js"), file(".rusuban/rules/02-ci.md")],
		closes: [9],
	});
	const live = { prs: [pr(1), rulesPr], issues: [issue(9)] };
	const held = {
		...fix(2, { owner: "alice", revisitAt: undefined }),
		decision: { id: "c", q: "?", options: [], createdAt: "2026-11-07T00:00:00Z", resolvedAt: null },
	};
	const todo = (items) => todoOf({ live, judgment: { items }, rules: { [REPO]: RULES } });
	// Neither judged (unjudged, a new commit) nor carded (missing-card), nor revisited.
	assert.deepEqual(
		todo({}).map((t) => t.item),
		["o/r#1", "o/r#9"],
	);
	assert.deepEqual(
		todo({ "o/r#2": { ...held, decision: null } }).map((t) => t.item),
		["o/r#1", "o/r#9"],
	);
	assert.deepEqual(
		todo({ "o/r#2": fix(2, { revisitAt: "2000-01-01T00:00:00Z" }) }).map((t) => t.item),
		["o/r#1", "o/r#9"],
	);
	const m = buildModel({ live, judgment: { items: {} }, rules: { [REPO]: RULES } });
	assert.deepEqual(
		m.nodes.map((n) => n.id),
		["o/r#1", "o/r#9"],
	);
	assert.equal(m.counts.all, 2);
	assert.ok(!m.edges.some((e) => e.from === "o/r#2" || e.to === "o/r#2"));
});

test("multi-repo: the same number in two repos is two items", () => {
	const live = { prs: [pr(1), pr(1, { repo: "o/b", head: "other" })], issues: [], merged: [] };
	const judgment = { items: { "o/r#1": fix(1) } };
	const todo = todoOf({ live, judgment, rules: { [REPO]: RULES, "o/b": RULES } });
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
	const running = { checks: [{ name: "test", workflow: "CI", state: "pending" }] };
	const live = {
		prs: [pr(1), pr(2, running), pr(3)],
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

test("ignoredChecks never block CI green, but never count for it alone", () => {
	const rules = (ignoredChecks, requiredChecks = []) => ({
		...RULES,
		locks: { ...LOCKS, ignoredChecks, requiredChecks },
	});
	const c = (name, workflow, state) => ({ name, workflow, state });
	const ci = (checks, r, over = {}) => by(gates(pr(1, { checks, ...over }), fix(1), r), "CI");
	const green = c("test", "CI", "success");
	assert.equal(ci([green, c("nix build", "Nix", "failure")], rules(["nix build"])).state, "ok");
	assert.equal(ci([green, c("nix build", "Nix", "pending")], rules(["Nix"])).state, "ok");
	const notify = { state: "action_required", runId: 9, runIds: [9], waiting: ["Discord"] };
	assert.equal(ci([green], rules(["Discord"]), { ci: notify }).state, "ok");
	assert.equal(ci([green], rules([]), { ci: notify }).state, "wait");
	// A fork's waiting workflows without a name cannot be told apart: they still block.
	const unnamed = { ...notify, waiting: [] };
	assert.equal(ci([green], rules(["Discord"]), { ci: unnamed }).state, "wait");
	const only = ci([c("nix build", "Nix", "success")], rules(["nix build"]));
	assert.deepEqual([only.state, only.detail], ["todo", "Only ignored checks on the head"]);
});

test("a merge order lifts the project's locks and the judgment for its head, never CI, threads, conflicts or a new commit", () => {
	const head = "sha1";
	const card = {
		id: "o/r#1@1",
		head,
		q: "Merge it?",
		createdAt: "2026-11-07T10:00:00Z",
		resolvedAt: null,
		options: [
			{ id: "merge", label: "Merge it", effect: "The server merges it.", merge: true },
			{ id: "keep", label: "Leave it", effect: "I leave it." },
		],
	};
	const judgment = (decision = card) => ({
		items: { "o/r#1": { ...fix(1, { owner: "alice", pr: { head, auto: false } }), decision } },
	});
	const answer = (option = "merge") => [
		{ item: "o/r#1", card: card.id, option, at: "2026-11-07T11:00:00Z", by: "alice" },
	];
	const orders = (p, j = judgment(), a = answer()) =>
		mergeOrdersOf({
			live: { prs: [p], issues: [] },
			judgment: j,
			answers: a,
			rules: { [REPO]: RULES },
			armed: true,
		});
	// A locked path and a judgment that said no: lifted by the person's order.
	const locked = pr(1, { files: [file(".github/workflows/ci.yml")] });
	const [o] = orders(locked);
	assert.deepEqual([o.item, o.card, o.by, o.eligible], ["o/r#1", card.id, "alice", true]);
	assert.deepEqual(orders(locked, judgment(), answer("keep")), []);
	assert.deepEqual(orders(locked, judgment(), []), []);
	const stopped = (p) =>
		orders(p)[0]
			.gates.filter((g) => g.state !== "ok")
			.map((g) => g.name);
	assert.deepEqual(stopped(pr(1, { head: "sha2" })), ["Head"]);
	assert.deepEqual(stopped(pr(1, { threadsOpen: 1 })), ["Threads"]);
	assert.deepEqual(stopped(pr(1, { mergeable: "CONFLICTING" })), ["Mergeable"]);
	const [paused] = mergeOrdersOf({
		live: { prs: [locked], issues: [] },
		judgment: judgment(),
		answers: answer(),
		rules: { [REPO]: RULES },
	});
	assert.deepEqual(
		[paused.eligible, paused.gates.find((g) => g.state !== "ok")?.name],
		[false, "Switch"],
		"a paused switch holds a person's order too",
	);
	assert.deepEqual(
		stopped(pr(1, { checks: [{ name: "test", workflow: "CI", state: "failure" }] })),
		["CI"],
	);
	const closed = judgment({ ...card, resolvedAt: "2026-11-07T12:00:00Z" });
	assert.deepEqual(orders(locked, closed), []);
});

test("conflict: a PR judged mergeable alone that its base moved under goes back to the agents", () => {
	const todo = (p, j = fix(1), rules = RULES) =>
		todoOf({
			live: { prs: [p], issues: [] },
			judgment: { items: { "o/r#1": j } },
			rules: { [REPO]: rules },
		}).map((t) => t.reason);
	assert.deepEqual(todo(pr(1, { mergeable: "CONFLICTING" })), ["conflict"]);
	// No mergeMethod: a rebase is assumed, so a PR that cannot be rebased conflicts too.
	assert.deepEqual(todo(pr(1, { canBeRebased: false })), ["conflict"]);
	const squash = { ...RULES, locks: { ...LOCKS, mergeMethod: "squash" } };
	assert.deepEqual(todo(pr(1, { canBeRebased: false }), fix(1), squash), []);
	const manual = fix(1, { pr: { head: "sha1", auto: false } });
	assert.deepEqual(todo(pr(1, { mergeable: "CONFLICTING" }), manual), []);
	assert.deepEqual(todo(pr(1, { mergeable: "UNKNOWN" })), []);
	assert.deepEqual(todo(pr(1, { mergeable: "CONFLICTING", draft: true })), []);
});
