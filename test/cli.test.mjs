import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyJudgment, closeCard, parseItem } from "../src/model.mjs";

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

test("evidence survives a rejudge on the same head only", () => {
	const judgment = fresh();
	judge(prJ({ pr: { head: "abc", auto: true, evidence: { state: "ok", head: "abc" } } }), judgment);
	assert.equal(judge(prJ(), judgment).pr.evidence.state, "ok");
	const moved = { prs: [{ repo: "o/r", n: 1, head: "def" }], issues: [] };
	assert.equal(judge(prJ({ pr: { head: "def", auto: true } }), judgment, moved).pr.evidence, null);
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
	const run = (...args) =>
		spawnSync(process.execPath, [BIN, ...args], {
			encoding: "utf8",
			env: { ...process.env, RUSUBAN_HOME: home, RUSUBAN_RUN: "judge-1", RUSUBAN_PROJECT: "" },
		});
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

	fs.writeFileSync(file, JSON.stringify(prJ({ pr: { head: "stale", auto: true } })));
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
	assert.equal(run("evidence", "#1", "running").status, 0);
	assert.equal(JSON.parse(run("show", "#1").stdout).judgment.pr.evidence.state, "running");
	assert.deepEqual(JSON.parse(run("answers").stdout), []);
	assert.match(run("--version").stdout, /^rusuban \d+\.\d+\.\d+/);
	assert.equal(run("nope").status, 1);
});
