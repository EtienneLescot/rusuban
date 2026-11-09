// The approval bypass (FR-029, T115) and refused merges (T116): `--admin` only on a merge the server
// makes anyway, only once the base branch's rules, read from GitHub, are met; the owner's commands
// closed to agents (T117). GitHub is replaced by recorders; the guard and the cycle are the real ones.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { builtInDeny, OWNER_COMMANDS } from "../src/agents.mjs";
import { append, read, readJsonl, saveConfig, validateConfig, write } from "../src/home.mjs";
import { bypassStops, refusedOf, requiredChecksOf, todoOf } from "../src/model.mjs";
import { validateLocks } from "../src/rules.mjs";
import { runCycle } from "../src/server.mjs";
import { confirmRequest, pendingRequests, settingsLog } from "../src/settings.mjs";

const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
const REPO = "o/r";
const ACTIONS = 15368;
const REVIEWER = 347564;
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
	checks: [{ name: "Test", workflow: "CI", state: "success" }],
	reviews: {},
	threadsOpen: 0,
	...over,
});
const auto = (n) => ({
	type: "pr",
	label: `Fix ${n}`,
	kind: "bug",
	owner: "agent",
	next: "Merges.",
	revisitAt: "2099-01-01T00:00:00Z",
	pr: { head: `sha${n}`, auto: true, why: "A fix" },
});
const rulesOf = (locks = {}) => ({
	[REPO]: {
		observeOnly: false,
		ref: "main",
		treeSha: "t1",
		files: [{ name: "01.md", text: "Fixes merge alone." }],
		locks: { mergeMethod: "rebase", ...locks },
		errors: [],
	},
});
const liveOf = (prs) => ({
	repos: { [REPO]: { defaultBranch: "main", prs, issues: [], merged: [], pushes: [] } },
});
const project = (over = {}) => ({
	id: "demo",
	bypassApproval: true,
	repos: [{ slug: REPO }],
	...over,
});

// The branch of a repo like OpenScreen's: an approval, a linear history, and two required checks, one
// from Actions, one from a review app.
const BRANCH = {
	rules: [
		{
			type: "pull_request",
			parameters: {
				required_approving_review_count: 1,
				dismiss_stale_reviews_on_push: true,
				required_review_thread_resolution: true,
				allowed_merge_methods: ["merge", "squash", "rebase"],
			},
		},
		{ type: "deletion" },
		{ type: "non_fast_forward" },
		{ type: "required_linear_history" },
		{
			type: "required_status_checks",
			parameters: {
				strict_required_status_checks_policy: false,
				required_status_checks: [
					{ context: "Test", integration_id: ACTIONS },
					{ context: "CodeRabbit", integration_id: REVIEWER },
				],
			},
		},
	],
	classic: null,
};
const run = (id, name, app, conclusion, status = "completed") => ({
	id,
	name,
	app,
	status,
	conclusion,
});
const GREEN = {
	runs: [run(1, "Test", ACTIONS, "success"), run(2, "CodeRabbit", REVIEWER, "success")],
	statuses: [],
};
const stopsOf = (over = {}) =>
	bypassStops({ ...BRANCH, ...GREEN, method: "rebase", pr: pr(1), ...over });

let merged;
let reads;
let deps;
let branch;
let checks;
const ctxOf = () => ({
	dry: false,
	loops: new Map(),
	say: () => {},
	config: { owner: { login: "alice" } },
});
const journal = () => readJsonl("projects/demo/journal.jsonl");
beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-bypass-"));
	merged = [];
	reads = [];
	branch = BRANCH;
	checks = GREEN;
	deps = {
		merge: async (a) => merged.push(a),
		requestRun: () => ({ id: "run-1" }),
		requestCoordinator: () => ({ id: "act-1" }),
		branchRules: async (slug, base) => {
			reads.push(`rules ${slug} ${base}`);
			return branch;
		},
		headChecks: async (slug, sha) => {
			reads.push(`checks ${slug} ${sha}`);
			return checks;
		},
	};
	write("automerge.json", { armed: true });
	write("projects/demo/judgment.json", { items: { "o/r#1": auto(1) } });
});
// A few milliseconds, so what comes next is strictly later than the refusal just journaled.
const later = () => new Promise((r) => setTimeout(r, 5));
const cycle = (p = project(), rules = rulesOf()) =>
	runCycle(ctxOf(), p, liveOf([pr(1)]), rules, deps);

test("the setting lives in the instance's config, off unless stated, and a repo cannot set it", () => {
	const config = (p) => ({
		version: 1,
		owner: { login: "alice" },
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 1, maxRunMinutes: 10 },
		projects: [{ id: "demo", repos: [{ slug: REPO }], ...p }],
	});
	assert.equal(validateConfig(config({})).projects[0].bypassApproval, false);
	assert.equal(validateConfig(config({ bypassApproval: true })).projects[0].bypassApproval, true);
	assert.throws(
		() => validateConfig(config({ bypassApproval: "yes" })),
		/bypassApproval must be true or false/,
	);
	// A PR that writes it into the locks file breaks the locks file: nothing merges at all.
	assert.match(
		validateLocks('{ "bypassApproval": true }').errors[0],
		/bypassApproval is not a known field/,
	);
});

test("the guard: every required check on the head, from its app, in its latest run, and success", () => {
	assert.deepEqual(stopsOf(), []);
	assert.deepEqual(stopsOf({ runs: [GREEN.runs[0]] }), ["CodeRabbit is missing on the head"]);
	assert.deepEqual(
		stopsOf({ runs: [GREEN.runs[0], run(2, "CodeRabbit", REVIEWER, "cancelled")] }),
		["CodeRabbit is cancelled on the head"],
	);
	assert.deepEqual(
		stopsOf({ runs: [GREEN.runs[0], run(2, "CodeRabbit", REVIEWER, null, "in_progress")] }),
		["CodeRabbit is in_progress on the head"],
	);
	// A job of the PR's own workflows named like the review app does not stand in for it.
	assert.deepEqual(stopsOf({ runs: [GREEN.runs[0], run(2, "CodeRabbit", ACTIONS, "success")] }), [
		"CodeRabbit is missing on the head",
	]);
	// The latest run counts: a failure fixed by a rerun passes, a success undone by one does not.
	assert.deepEqual(
		stopsOf({
			runs: [run(1, "Test", ACTIONS, "failure"), run(3, "Test", ACTIONS, "success"), GREEN.runs[1]],
		}),
		[],
	);
	assert.deepEqual(
		stopsOf({
			runs: [run(1, "Test", ACTIONS, "success"), run(3, "Test", ACTIONS, "failure"), GREEN.runs[1]],
		}),
		["Test is failure on the head"],
	);
	// A status counts only where the rule names no app.
	const anyApp = {
		...BRANCH,
		rules: [
			{
				type: "required_status_checks",
				parameters: { required_status_checks: [{ context: "deploy" }] },
			},
		],
	};
	assert.deepEqual(
		bypassStops({
			...anyApp,
			runs: [],
			statuses: [{ context: "deploy", state: "success" }],
			method: "rebase",
			pr: pr(1),
		}),
		[],
	);
	assert.deepEqual(
		bypassStops({
			...anyApp,
			runs: [],
			statuses: [{ context: "deploy", state: "pending" }],
			method: "rebase",
			pr: pr(1),
		}),
		["deploy is pending on the head"],
	);
	const classic = { required_status_checks: { checks: [{ context: "Build", app_id: ACTIONS }] } };
	assert.deepEqual(requiredChecksOf({ rules: [], classic }), [{ name: "Build", app: ACTIONS }]);
});

test("the guard: a rule the bypass would skip, or one it does not know, stops it", () => {
	assert.deepEqual(stopsOf({ method: "merge" }), [
		"the branch requires a linear history, and the merge method is merge",
	]);
	const rule = (type, parameters) => stopsOf({ rules: [{ type, parameters }] });
	assert.deepEqual(rule("pull_request", { allowed_merge_methods: ["squash"] }), [
		"the branch does not allow the rebase method",
	]);
	assert.deepEqual(rule("pull_request", { require_code_owner_review: true }), [
		"the branch requires a code owner's review",
	]);
	assert.deepEqual(rule("pull_request", { automatic_reviews: true }), [
		"the branch's pull request rule has automatic_reviews",
	]);
	assert.deepEqual(stopsOf({ pr: pr(1, { threadsOpen: 1 }) }), ["a review thread is open"]);
	assert.deepEqual(rule("required_signatures"), [
		"the branch has a required_signatures rule, which the bypass cannot check",
	]);
	assert.deepEqual(
		rule("required_status_checks", {
			strict_required_status_checks_policy: true,
			required_status_checks: [],
		}),
		["the branch requires PRs up to date with it, which the bypass cannot check"],
	);
});

test("the guard: classic protection read in full, its approval and push-only settings pass, the rest stops it", () => {
	const off = { enabled: false };
	const passes = {
		url: "https://api.github.com/repos/o/r/branches/main/protection",
		required_status_checks: { strict: false, contexts: [], checks: [] },
		required_pull_request_reviews: {
			required_approving_review_count: 1,
			dismiss_stale_reviews: true,
			require_last_push_approval: true,
			require_code_owner_reviews: false,
		},
		required_linear_history: { enabled: true },
		required_conversation_resolution: { enabled: true },
		required_signatures: off,
		enforce_admins: off,
		lock_branch: off,
		allow_force_pushes: off,
		allow_deletions: off,
		block_creations: off,
		allow_fork_syncing: off,
	};
	const classic = (over) => stopsOf({ classic: { ...passes, ...over } });
	assert.deepEqual(classic({}), []);
	assert.deepEqual(classic({ required_status_checks: { strict: true } }), [
		"the branch requires PRs up to date with it, which the bypass cannot check",
	]);
	assert.deepEqual(
		classic({ required_pull_request_reviews: { require_code_owner_reviews: true } }),
		["the branch requires a code owner's review"],
	);
	assert.deepEqual(classic({ required_signatures: { enabled: true } }), [
		"the branch requires signed commits, which the bypass cannot check",
	]);
	assert.deepEqual(classic({ enforce_admins: { enabled: true } }), [
		"the branch's protection binds administrators too",
	]);
	assert.deepEqual(classic({ restrictions: { users: [], teams: [], apps: [] } }), [
		"the branch restricts who can push to it",
	]);
	assert.deepEqual(classic({ lock_branch: { enabled: true } }), ["the branch is locked"]);
	assert.deepEqual(classic({ merge_queue: { enabled: true } }), [
		"the branch's protection has merge_queue",
	]);
	assert.deepEqual(classic({ required_pull_request_reviews: { require_review_from_bots: true } }), [
		"the branch's protection has require_review_from_bots",
	]);
	// What a ruleset and classic protection both require is said once.
	assert.deepEqual(stopsOf({ classic: passes, method: "merge" }), [
		"the branch requires a linear history, and the merge method is merge",
	]);
	assert.deepEqual(stopsOf({ classic: passes, pr: pr(1, { threadsOpen: 1 }) }), [
		"a review thread is open",
	]);
});

test("off, the server never merges with --admin; on, it does only what it merges anyway, rules met", async () => {
	await cycle(project({ bypassApproval: false }));
	assert.deepEqual(merged, [{ slug: REPO, n: 1, method: "rebase", head: "sha1", admin: false }]);
	assert.deepEqual(reads, [], "off: the branch is not even read");

	fs.rmSync(path.join(process.env.RUSUBAN_HOME, "projects/demo/journal.jsonl"));
	merged.length = 0;
	await cycle();
	assert.deepEqual(merged, [{ slug: REPO, n: 1, method: "rebase", head: "sha1", admin: true }]);
	assert.deepEqual(reads, ["rules o/r main", "checks o/r sha1"]);
	const [entry] = journal();
	assert.deepEqual([entry.kind, entry.admin], ["merge", true]);
	assert.match(entry.text, /^Merged alone through the approval bypass \(--admin\): Fix 1\./);

	// Paused, nothing merges alone, bypass or not.
	merged.length = 0;
	write("projects/demo/judgment.json", { items: { "o/r#2": auto(2) } });
	write("automerge.json", { armed: false });
	await runCycle(ctxOf(), project(), liveOf([pr(2)]), rulesOf(), deps);
	assert.deepEqual(merged, []);
	// A person's merge order waits while paused too; armed again, it is a merge the server makes
	// anyway, so it goes through the bypass, the branch's rules met.
	const order = {
		id: "o/r#2@1",
		head: "sha2",
		to: "alice",
		q: "Merge it?",
		createdAt: new Date().toISOString(),
		resolvedAt: null,
		options: [{ id: "merge", label: "Merge it", effect: "The server merges it.", merge: true }],
	};
	write("projects/demo/judgment.json", { items: { "o/r#2": { ...auto(2), decision: order } } });
	append("projects/demo/answers.jsonl", {
		at: new Date().toISOString(),
		item: "o/r#2",
		card: order.id,
		option: "merge",
		by: "alice",
	});
	write("automerge.json", { armed: false });
	await runCycle(ctxOf(), project(), liveOf([pr(2)]), rulesOf(), deps);
	assert.deepEqual(merged, [], "paused: the order waits");
	write("automerge.json", { armed: true });
	await runCycle(ctxOf(), project(), liveOf([pr(2)]), rulesOf(), deps);
	assert.deepEqual(merged, [{ slug: REPO, n: 2, method: "rebase", head: "sha2", admin: true }]);
});

test("a required check missing or red stops the bypass, said once per head; ignored checks count", async () => {
	checks = { runs: [GREEN.runs[0], run(2, "CodeRabbit", REVIEWER, "cancelled")], statuses: [] };
	// The locks file ignores CodeRabbit, so the server's own CI gate lets the PR through: the branch
	// still requires it, so the bypass does not.
	const rules = rulesOf({ ignoredChecks: ["CodeRabbit"] });
	const live = liveOf([
		pr(1, { checks: [...pr(1).checks, { name: "CodeRabbit", workflow: null, state: "failure" }] }),
	]);
	await runCycle(ctxOf(), project(), live, rules, deps);
	await runCycle(ctxOf(), project(), live, rules, deps);
	assert.deepEqual(merged, []);
	const said = journal().filter((e) => e.kind === "bypass-stopped");
	assert.equal(said.length, 1);
	assert.deepEqual([said[0].head, said[0].notify], ["sha1", true]);
	assert.match(
		said[0].text,
		/^Not merged through the approval bypass on sha1: CodeRabbit is cancelled on the head\.$/,
	);

	checks = GREEN;
	await runCycle(ctxOf(), project(), live, rules, deps);
	assert.deepEqual(
		merged.map((m) => m.admin),
		[true],
		"green again: it merges",
	);

	merged.length = 0;
	write("projects/demo/judgment.json", { items: { "o/r#2": auto(2) } });
	deps.branchRules = async () => {
		throw new Error("HTTP 403");
	};
	await runCycle(ctxOf(), project(), liveOf([pr(2)]), rulesOf(), deps);
	assert.deepEqual(merged, []);
	assert.match(journal().at(-1).text, /could not be read: HTTP 403/);
});

test("a refused head is never tried again, a restart included; a card settles it, an order or the bypass tries once more", async () => {
	deps.merge = async (a) => {
		merged.push(a);
		throw Object.assign(new Error("x"), { stderr: "At least 1 approving review is required" });
	};
	const off = project({ bypassApproval: false });
	await cycle(off);
	await cycle(off); // a fresh context each time: the journal is the record
	assert.equal(merged.length, 1);
	const [refusal] = journal();
	assert.deepEqual([refusal.kind, refusal.admin, refusal.notify], ["merge-refused", false, true]);

	// The agents are asked to put it on a card; a card written after the refusal settles it.
	const live = { prs: [pr(1)], issues: [] };
	const todo = (judgment) =>
		todoOf({ live, judgment, rules: rulesOf(), refused: refusedOf(journal()) }).map(
			(t) => t.reason,
		);
	assert.deepEqual(todo(read("projects/demo/judgment.json")), ["merge-refused"]);
	await later();
	const card = {
		id: "o/r#1@1",
		q: "Approve it?",
		createdAt: new Date().toISOString(),
		resolvedAt: "2099-01-01T00:00:00Z",
		options: [],
	};
	assert.deepEqual(todo({ items: { "o/r#1": { ...auto(1), decision: card } } }), []);

	// The bypass turned on since: one more try, through it.
	await cycle(project());
	assert.deepEqual(
		merged.map((m) => m.admin),
		[false, true],
	);
	await cycle(project());
	assert.equal(merged.length, 2);

	// A person's merge order given after the refusals: one more try.
	await later();
	const order = {
		id: "o/r#1@2",
		head: "sha1",
		to: "alice",
		q: "Merge it?",
		createdAt: new Date().toISOString(),
		resolvedAt: null,
		options: [{ id: "merge", label: "Merge it", effect: "The server merges it.", merge: true }],
	};
	write("projects/demo/judgment.json", { items: { "o/r#1": { ...auto(1), decision: order } } });
	append("projects/demo/answers.jsonl", {
		at: new Date().toISOString(),
		item: "o/r#1",
		card: order.id,
		option: "merge",
		by: "alice",
	});
	await cycle(off);
	await cycle(off);
	assert.equal(merged.length, 3);
});

test("the owner's commands are closed to agents; the bypass turned on waits for the owner", () => {
	saveConfig({
		version: 1,
		owner: { login: "alice" },
		port: 0,
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 1, maxRunMinutes: 10 },
		projects: [{ id: "demo", repos: [{ slug: REPO }] }],
	});
	const cli = (env, ...args) =>
		spawnSync(process.execPath, [BIN, ...args], {
			encoding: "utf8",
			env: { ...process.env, ...env },
		});
	const asAgent = (...args) => cli({ RUSUBAN_RUN: "act-1", RUSUBAN_PROJECT: "demo" }, ...args);
	assert.match(
		asAgent("project", "bypass", "demo", "on").stderr,
		/"project" is the owner's command, never run inside an agent run/,
	);
	assert.match(asAgent("task", "list").stderr, /owner's command/);
	assert.match(asAgent("start").stderr, /owner's command/);
	assert.match(asAgent("permissions", "bypass").stderr, /owner's command/);
	assert.equal(read("config.json").projects[0].bypassApproval, false);
	// Layer 1 (FR-095): every owner's command and Rusuban's own MCP server are denied to every run.
	const deny = builtInDeny();
	for (const c of OWNER_COMMANDS) assert.ok(deny.includes(`Bash(rusuban ${c}*)`), c);
	assert.ok(deny.includes("mcp__rusuban"));

	// A project added, once the owner allows it, is off. Asked without a terminal, turning it on waits
	// for the owner (FR-092).
	assert.equal(cli({}, "project", "add", "o/other").status, 0);
	confirmRequest(pendingRequests()[0].id, { allow: true, by: "alice" });
	assert.equal(read("config.json").projects[1].bypassApproval, false);
	const on = cli({}, "project", "bypass", "demo", "on");
	assert.equal(on.status, 0, on.stderr);
	assert.match(
		on.stdout,
		/^Let the server merge with your bypass on demo\?\nIt waits for your confirmation/,
	);
	assert.equal(read("config.json").projects[0].bypassApproval, false);
	const [request] = pendingRequests();
	assert.equal(confirmRequest(request.id, { allow: true, by: "alice" }).state, "confirmed");
	assert.equal(read("config.json").projects[0].bypassApproval, true);
	assert.match(cli({}, "project", "bypass", "demo", "on").stdout, /already on/);
	assert.match(cli({}, "project", "bypass", "demo", "maybe").stderr, /usage: project add/);
	// Turning it off narrows: it applies at once.
	assert.match(
		cli({}, "project", "bypass", "demo", "off").stdout,
		/^project demo: approval bypass off\./,
	);
	assert.equal(read("config.json").projects[0].bypassApproval, false);
	assert.deepEqual(
		settingsLog()
			.filter((e) => e.setting === "project.bypass")
			.map((e) => [e.origin, e.state, !!e.notify]),
		[
			["cli", "pending", false],
			["cli", "confirmed", true],
			["cli", "applied", false],
		],
	);
});
