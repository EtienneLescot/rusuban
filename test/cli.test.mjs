import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyEvidence, applyJudgment, closeCard, parseItem } from "../src/model.mjs";

const REPOS = ["o/r"];
const live = { prs: [{ repo: "o/r", n: 1, head: "abc" }], issues: [{ repo: "o/r", n: 10 }] };
const fresh = () => ({ items: {} });
const NOW = "2026-11-07T12:00:00.000Z";
const LATER = "2026-11-09T12:00:00.000Z";
const judge = (j, judgment = fresh(), l = live) =>
	applyJudgment(j, l, judgment, { repos: REPOS, now: NOW });
const prJ = (over = {}) => ({
	n: 1,
	label: "Fix",
	kind: "bug",
	owner: "agent",
	next: "Merge once the gates are green.",
	revisitAt: LATER,
	pr: { head: "abc", auto: true },
	...over,
});
const card = (over = {}) => ({
	urgency: "now",
	done: "I read the issue and its thread.",
	q: "Build it?",
	ctx: "Asked by two users.",
	rec: "yes",
	why: "Small and wanted.",
	options: [
		{ id: "yes", label: "Build it", effect: "I open a PR." },
		{ id: "no", label: "Close it", effect: "I close it, kindly." },
	],
	...over,
});
const issueJ = (over = {}) => ({
	item: "#10",
	label: "Request",
	kind: "feature",
	owner: "alice",
	next: "Alice decides.",
	...over,
});

test("a PR is judged only on its live head", () => {
	assert.throws(() => judge(prJ({ pr: { head: "old", auto: true } })), /live head abc/);
	assert.equal(judge(prJ()).pr.head, "abc");
});

test("the rules decide what may merge: no kind is barred from pr.auto", () => {
	assert.equal(judge(prJ({ kind: "feature" })).pr.auto, true);
});

test("agents and third parties need a future revisitAt, and a third party is named", () => {
	assert.throws(() => judge(prJ({ revisitAt: undefined })), /revisitAt is required/);
	assert.throws(() => judge(prJ({ revisitAt: "2026-11-01T00:00:00Z" })), /revisitAt is required/);
	assert.throws(() => judge(prJ({ owner: "third" })), /waits is required/);
	assert.equal(judge(prJ({ owner: "third", waits: "@a" })).revisitAt, LATER);
});

test("an item held by a person carries an open card, addressed to them", () => {
	assert.throws(() => judge(issueJ()), /open card/);
	const j = judge(issueJ({ decision: card() }));
	assert.deepEqual(
		[j.decision.to, j.decision.state, j.decision.rec, j.revisitAt],
		["alice", "open", "yes", undefined],
	);
	assert.throws(() => judge(issueJ({ decision: card({ rec: "maybe" }) })), /id of an option/);
	assert.throws(() => judge(issueJ({ decision: card({ done: "" }) })), /decision.done/);
	assert.throws(() => judge(issueJ({ decision: card({ urgency: undefined }) })), /urgency/);
	assert.throws(() => judge(prJ({ decision: card() })), /a card goes to a person/);
});

test("a new judgment replaces an open card when the item leaves its person", () => {
	const judgment = fresh();
	judge(issueJ({ decision: card() }), judgment);
	const back = judge(
		{
			item: "o/r#10",
			label: "Request",
			kind: "feature",
			owner: "agent",
			next: "I build it.",
			revisitAt: LATER,
		},
		judgment,
	);
	assert.equal(back.decision.state, "replaced");
});

test("closed or unknown items are refused, and #n needs a one-repo project", () => {
	assert.throws(() => judge(prJ({ n: 99 })), /neither an open PR nor an open issue/);
	assert.throws(() => parseItem("#3", ["o/a", "o/b"]), /several repos/);
	assert.equal(parseItem("o/b#3", ["o/a", "o/b"]), "o/b#3");
	assert.throws(() => parseItem("x/y#3", ["o/a"]), /not a repo of this project/);
});

test("a judgment asks for a proof; a worker other than the judging run records it, on the live head", () => {
	const judgment = fresh();
	const ok = { head: "abc", auto: true, evidence: { needed: true, state: "ok" } };
	assert.throws(() => judge(prJ({ pr: ok }), judgment), /only asks for a proof/);
	const asked = { head: "abc", auto: true, evidence: { needed: true } };
	assert.equal(judge(prJ({ pr: asked }), judgment).pr.evidence.state, "todo");
	applyJudgment(prJ(), live, judgment, { repos: REPOS, now: NOW, by: "agent:judge-1" });
	assert.throws(() => applyEvidence(judgment, live, "o/r#1", "ok"), /worker run/);
	assert.throws(
		() => applyEvidence(judgment, live, "o/r#1", "ok", { run: "judge-1" }),
		/judged it/,
	);
	const proof = { run: "worker-2", conversation: "s-1", href: "https://example.com/report" };
	const e = applyEvidence(judgment, live, "o/r#1", "ok", proof);
	assert.deepEqual([e.state, e.head, e.run, e.conversation], ["ok", "abc", "worker-2", "s-1"]);
	// It survives a rejudge on the same head, never a new commit.
	assert.equal(judge(prJ(), judgment).pr.evidence.state, "ok");
	const moved = { prs: [{ repo: "o/r", n: 1, head: "def" }], issues: [] };
	assert.equal(judge(prJ({ pr: { head: "def", auto: true } }), judgment, moved).pr.evidence, null);
});

test("a merge order is an option of a PR's card, tied to the head the card was written on", () => {
	const judgment = fresh();
	const order = [
		{ id: "merge", label: "Merge it", effect: "The server merges it.", merge: true },
		{ id: "wait", label: "Leave it", effect: "I leave it open." },
	];
	const prCard = (l = live) =>
		applyJudgment(
			prJ({
				owner: "alice",
				revisitAt: undefined,
				decision: card({ options: order, rec: "merge" }),
			}),
			l,
			judgment,
			{ repos: REPOS, now: NOW },
		).decision;
	const first = prCard();
	assert.equal(first.head, "abc");
	assert.equal(prCard().id, first.id, "the same question on the same head is the same card");
	const moved = { prs: [{ repo: "o/r", n: 1, head: "def" }], issues: [] };
	const again = applyJudgment(
		prJ({
			owner: "alice",
			revisitAt: undefined,
			pr: { head: "def", auto: false },
			decision: card({ options: order, rec: "merge" }),
		}),
		moved,
		judgment,
		{ repos: REPOS, now: NOW },
	).decision;
	assert.notEqual(again.id, first.id, "a new head is a new card");
	assert.throws(
		() => judge(issueJ({ decision: card({ options: order, rec: "merge" }) })),
		/PR's card only/,
	);
	const bad = [{ ...order[0], merge: "yes" }, order[1]];
	assert.throws(
		() => judge(issueJ({ decision: card({ options: bad, rec: "wait" }) })),
		/merge is true/,
	);
});

test("closing a card: resolved once answered, replaced otherwise", () => {
	const judgment = fresh();
	const { decision } = judge(issueJ({ decision: card() }), judgment);
	const answers = [{ item: "o/r#10", card: decision.id, option: "yes", at: NOW }];
	assert.equal(closeCard(judgment, "o/r#10", "PR opened.", answers).state, "resolved");
	assert.throws(() => closeCard(judgment, "o/r#10", "again"), /no open card/);
	judge(issueJ({ decision: card({ q: "Still?" }) }), judgment);
	assert.equal(closeCard(judgment, "o/r#10", "Moot.", answers).state, "replaced");
});

// ── The command itself, against a scratch instance home ───────────────────────────────────────
const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));

test("the agent commands read and write a project's files", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-cli-"));
	const put = (name, value) => {
		fs.mkdirSync(path.dirname(path.join(home, name)), { recursive: true });
		fs.writeFileSync(path.join(home, name), JSON.stringify(value));
	};
	put("config.json", {
		version: 1,
		owner: { login: "alice" },
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 3, maxRunMinutes: 150 },
		projects: [{ id: "demo", mode: "live", repos: [{ slug: "o/r" }] }],
	});
	put("projects/demo/live.json", {
		repos: {
			"o/r": {
				defaultBranch: "main",
				prs: [
					{
						repo: "o/r",
						n: 1,
						head: "abc",
						files: [],
						ci: { state: "success", runIds: [], waiting: [] },
					},
				],
				issues: [{ repo: "o/r", n: 10 }],
				merged: [],
			},
		},
	});
	put("projects/demo/rules.json", { "o/r": { observeOnly: false, locks: null, errors: [] } });
	const runAs = (runId, ...args) =>
		spawnSync(process.execPath, [BIN, ...args], {
			encoding: "utf8",
			env: { ...process.env, RUSUBAN_HOME: home, RUSUBAN_RUN: runId, RUSUBAN_PROJECT: "" },
		});
	const run = (...args) => runAs("judge-1", ...args);
	const todo = () => JSON.parse(run("todo").stdout).map((t) => `${t.item}:${t.reason}`);

	assert.deepEqual(todo(), ["o/r#1:unjudged", "o/r#10:unjudged"]);
	const file = path.join(home, "j.json");
	fs.writeFileSync(file, JSON.stringify([prJ({ revisitAt: "2099-01-01T00:00:00Z" })]));
	const judged = run("judge", file);
	assert.equal(judged.status, 0, judged.stderr);
	assert.match(judged.stdout, /1 judgment written: o\/r#1/);
	assert.deepEqual(todo(), ["o/r#10:unjudged"]);
	const shown = JSON.parse(run("show", "#1").stdout);
	assert.deepEqual([shown.item, shown.judgment.judgedBy], ["o/r#1", "agent:judge-1"]);

	const stale = prJ({ revisitAt: "2099-01-01T00:00:00Z", pr: { head: "stale", auto: true } });
	fs.writeFileSync(file, JSON.stringify(stale));
	const refused = run("judge", file);
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /^refused: o\/r#1: pr.head must be the live head/);

	// The agent CLI writes its own journal file, never the daemon's, and leaves no lock behind.
	assert.equal(run("log", "note", "#10", "Asked the reporter for logs.").status, 0);
	const entry = JSON.parse(
		fs.readFileSync(path.join(home, "projects/demo/agent-log.jsonl"), "utf8").trim(),
	);
	assert.deepEqual(
		[entry.item, entry.by, entry.text],
		["o/r#10", "agent:judge-1", "Asked the reporter for logs."],
	);
	assert.ok(!fs.existsSync(path.join(home, "projects/demo/journal.jsonl")));
	assert.ok(!fs.existsSync(path.join(home, "projects/demo/judgment.lock")));
	// A proof comes from a worker run, never from the judging run.
	assert.match(run("evidence", "#1", "running").stderr, /recorded by a worker run/);
	put("runs/worker-1/status.json", {
		id: "worker-1",
		kind: "worker",
		project: "demo",
		state: "done",
		session: "s-9",
	});
	assert.equal(runAs("worker-1", "evidence", "#1", "running").status, 0);
	const proof = JSON.parse(run("show", "#1").stdout).judgment.pr.evidence;
	assert.deepEqual([proof.state, proof.run, proof.conversation], ["running", "worker-1", "s-9"]);
	assert.deepEqual(JSON.parse(run("answers").stdout), []);
	assert.match(run("--version").stdout, /^rusuban \d+\.\d+\.\d+/);
	assert.equal(run("nope").status, 1);
});

test("lease and release: a run's commands, with a machine or an OS, a reason and a duration", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-lease-"));
	fs.writeFileSync(
		path.join(home, "config.json"),
		JSON.stringify({
			version: 1,
			owner: { login: "alice" },
			permissions: { mode: "allowlist" },
			limits: { maxWorkers: 3, maxRunMinutes: 150 },
			projects: [{ id: "demo", mode: "live", repos: [{ slug: "o/r" }] }],
			machines: [{ name: "mac", os: "macos", ssh: "mac" }],
		}),
	);
	const cli = (env, ...args) =>
		spawnSync(process.execPath, [BIN, ...args], {
			encoding: "utf8",
			env: { ...process.env, RUSUBAN_HOME: home, RUSUBAN_RUN: "", RUSUBAN_PROJECT: "", ...env },
		});
	assert.match(cli({}, "lease", "mac", "--reason", "x").stderr, /lease is a run's command/);
	const inRun = (...args) => cli({ RUSUBAN_RUN: "w-1" }, ...args).stderr;
	assert.match(inRun("lease", "mac", "--os", "macos", "--reason", "x"), /usage: lease/);
	assert.match(inRun("lease", "--reason", "x"), /usage: lease/);
	assert.match(inRun("lease", "mac", "--wait", "soon", "--reason", "x"), /soon is not a duration/);
	// A run that is not running holds nothing: the lease lasts as long as its run.
	assert.match(inRun("lease", "mac", "--reason", "measure"), /run w-1 is not running/);
	assert.match(inRun("release"), /usage: release <machine>/);
	assert.match(cli({}, "machine", "doctor", "nope").stderr, /no machine named nope/);
	assert.deepEqual(
		JSON.parse(cli({}, "machine", "list").stdout).map((m) => [m.name, m.agentUser]),
		[["mac", "rusuban"]],
	);
});

test("rusuban guard, Claude Code's hook: exit 2 with the reason refuses a command", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-guard-"));
	fs.writeFileSync(
		path.join(home, "config.json"),
		JSON.stringify({
			version: 1,
			owner: { login: "alice" },
			permissions: { mode: "bypass" },
			limits: { maxWorkers: 3, maxRunMinutes: 150 },
			projects: [{ id: "demo", mode: "live", repos: [{ slug: "o/r" }] }],
			machines: [{ name: "desk", os: "windows", ssh: "desk.invalid", owner: "alice" }],
		}),
	);
	const guard = (input) =>
		spawnSync(process.execPath, [BIN, "guard"], {
			encoding: "utf8",
			input: typeof input === "string" ? input : JSON.stringify(input),
			env: { ...process.env, RUSUBAN_HOME: home, RUSUBAN_RUN: "" },
		});
	const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
	assert.equal(guard(bash("ls")).status, 0);
	assert.equal(guard({ tool_name: "Read", tool_input: { file_path: "desk.invalid" } }).status, 0);
	assert.equal(guard(bash("rusuban lease desk --reason measure")).status, 0);
	const refused = guard(bash("ssh desk.invalid uname"));
	assert.equal(refused.status, 2);
	assert.match(
		refused.stderr,
		/desk is alice's desktop: only a run that holds its lease reaches it/,
	);
	const broken = guard("not json");
	assert.equal(broken.status, 2);
	assert.match(broken.stderr, /the desktop guard could not judge this command/);
});
