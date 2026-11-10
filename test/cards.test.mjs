// Decision cards (T036, T039): their derived state, the answers they take once, the inbox; and the
// routes that record answers and requests, list and stop runs (T037, T101), on a real server whose
// agent starters are recorders.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { append, read, readJsonl, saveConfig, write } from "../src/home.mjs";
import { applyJudgment, cardState, checkAnswer, closeCard, inboxOf } from "../src/model.mjs";
import { startServer } from "../src/server.mjs";

const NOW = "2026-11-07T12:00:00.000Z";
const LATER = "2026-11-09T12:00:00.000Z";
const live = {
	prs: [
		{
			repo: "o/r",
			n: 1,
			head: "abc",
			title: "Add median()",
			url: "u1",
			draft: false,
			files: [],
			refs: [],
			closes: [],
			mergeable: "MERGEABLE",
			canBeRebased: true,
			ci: { state: "success", runIds: [], waiting: [] },
			checks: [{ name: "test", workflow: "CI", state: "success" }],
			reviews: {},
			threadsOpen: 0,
		},
	],
	issues: [{ repo: "o/r", n: 10, title: "Dark mode", url: "u10" }],
};
const options = [
	{ id: "build", label: "Build it", effect: "I open a PR." },
	{ id: "close", label: "Close it", effect: "I close it, kindly." },
];
const card = (over = {}) => ({
	urgency: "digest",
	done: "I read the thread.",
	q: "Build dark mode?",
	ctx: "Asked by two users.",
	rec: "build",
	why: "Small and wanted.",
	options,
	...over,
});
const toAlice = (judgment, over = {}, now = NOW) =>
	applyJudgment(
		{
			item: "#10",
			label: "Dark mode",
			kind: "feature",
			owner: "alice",
			next: "Alice decides.",
			decision: card(over),
		},
		live,
		judgment,
		{ repos: ["o/r"], now },
	).decision;

test("a card is open, resolved by its answer, or replaced by a newer judgment", () => {
	const judgment = { items: {} };
	const d = toAlice(judgment);
	assert.equal(cardState("o/r#10", d, []), "open");
	const answers = [{ item: "o/r#10", card: d.id, option: "build", at: NOW }];
	assert.equal(cardState("o/r#10", d, answers), "resolved");
	closeCard(judgment, "o/r#10", "PR #11 opened.", answers);
	assert.deepEqual([d.state, d.outcome], ["resolved", "PR #11 opened."]);
	assert.equal(toAlice(judgment, { q: "Ship it now?" }).state, "open");
	applyJudgment(
		{
			item: "#10",
			label: "Dark mode",
			kind: "feature",
			owner: "agent",
			next: "I build it.",
			revisitAt: LATER,
		},
		live,
		judgment,
		{ repos: ["o/r"], now: NOW },
	);
	assert.equal(cardState("o/r#10", judgment.items["o/r#10"].decision, []), "replaced");
});

test("an issue follows the PR that addresses it: no card of its own while the PR has one", () => {
	const judgment = { items: {} };
	const pr = (over) => ({ ...live, prs: [{ ...live.prs[0], ...over }] });
	const prCard = (links = {}) =>
		applyJudgment(
			{
				item: "#1",
				label: "Add median()",
				kind: "feature",
				owner: "alice",
				next: "Alice decides.",
				pr: { head: "abc", auto: false },
				links,
				decision: card({ q: "Merge median()?" }),
			},
			live,
			judgment,
			{ repos: ["o/r"], now: NOW },
		);
	const issueCard = (lv) =>
		applyJudgment(
			{
				item: "#10",
				label: "Dark mode",
				kind: "feature",
				owner: "alice",
				next: "Alice decides.",
				decision: card(),
			},
			lv,
			judgment,
			{ repos: ["o/r"], now: NOW },
		);
	const refused = /o\/r#1 addresses this issue and has an open card, so the issue follows it/;
	// The PR's card is open: an issue it closes, names or links gets none.
	prCard();
	assert.throws(() => issueCard(pr({ closes: ["#10"] })), refused);
	assert.throws(() => issueCard(pr({ refs: ["o/r#10"] })), refused);
	prCard({ issues: ["#10"] });
	assert.throws(() => issueCard(live), refused);
	// It follows the PR, held by the agents.
	const follows = applyJudgment(
		{
			item: "#10",
			label: "Dark mode",
			kind: "feature",
			owner: "agent",
			next: "Follows PR #1.",
			revisitAt: LATER,
		},
		live,
		judgment,
		{ repos: ["o/r"], now: NOW },
	);
	assert.equal(follows.decision, undefined);
	// The PR's card closed, the issue may get its own.
	closeCard(judgment, "o/r#1", "Merged.", [], NOW);
	assert.equal(issueCard(live).decision.state, "open");
});

test("an answer is checked against its card: a replaced card and a second answer are refused", () => {
	const judgment = { items: {} };
	const d = toAlice(judgment);
	const check = (over = {}, answers = []) =>
		checkAnswer({ judgment, answers, item: "o/r#10", card: d.id, option: "build", ...over });
	assert.deepEqual(check(), { chosen: options[0], note: "" });
	assert.deepEqual(check({ option: "other", note: " Only for the editor. " }), {
		chosen: null,
		note: "Only for the editor.",
	});
	assert.equal(check({ card: "o/r#10@1-x" }).status, 404);
	assert.equal(check({ item: "o/r#1" }).status, 404);
	assert.equal(check({ option: "maybe" }).status, 400);
	assert.equal(check({ option: "other", note: " " }).status, 400);
	assert.equal(check({ option: "other", note: "x".repeat(2001) }).status, 400);
	const once = [{ item: "o/r#10", card: d.id, option: "close", at: NOW }];
	assert.deepEqual(check({}, once), { status: 409, error: "this card is already answered" });
	toAlice(judgment, { q: "A new question" });
	assert.equal(check().status, 404, "the old card is no longer the item's");
	judgment.items["o/r#10"].decision.state = "replaced";
	const replaced = judgment.items["o/r#10"].decision;
	assert.match(
		checkAnswer({ judgment, item: "o/r#10", card: replaced.id, option: "build" }).error,
		/replaced/,
	);
});

test("the inbox lists every project's waiting cards, newest first, with their answer", () => {
	const a = { items: {} };
	const older = toAlice(a, {}, "2026-11-07T10:00:00.000Z");
	const b = { items: {} };
	const newer = toAlice(b, {}, "2026-11-07T11:00:00.000Z");
	const gone = { items: {} };
	toAlice(gone);
	const inbox = inboxOf([
		{
			id: "one",
			title: "One",
			live,
			judgment: a,
			answers: [{ item: "o/r#10", card: older.id, option: "build", at: NOW }],
		},
		{ id: "two", live, judgment: b },
		{ id: "three", live: { prs: [], issues: [] }, judgment: gone },
	]);
	assert.deepEqual(
		inbox.map((c) => [
			c.project,
			c.card.id === older.id ? "older" : c.card.id === newer.id ? "newer" : "gone",
		]),
		[
			["three", "gone"],
			["two", "newer"],
			["one", "older"],
		],
	);
	assert.deepEqual(
		[inbox[2].answer.option, inbox[2].projectTitle, inbox[2].label],
		["build", "One", "Dark mode"],
	);
	assert.deepEqual([inbox[0].itemOpen, inbox[1].itemOpen], [false, true]);
	closeCard(a, "o/r#10", "Done.", [{ item: "o/r#10", card: older.id, option: "build", at: NOW }]);
	assert.equal(inboxOf([{ id: "one", live, judgment: a }]).length, 0);
});

// ── The routes, on a real server ──────────────────────────────────────────────────────────────
let srv;
const started = [];
const OWNER = { login: "alice" };
before(async () => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-cards-"));
	saveConfig({
		version: 1,
		owner: OWNER,
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 3, maxRunMinutes: 150 },
		model: "claude-test",
		projects: [{ id: "demo", repos: [{ slug: "o/r" }] }],
	});
	srv = await startServer({
		port: 0,
		polling: false,
		quiet: true,
		tailnet: null,
		deps: {
			requestCoordinator: (project, trigger) => {
				started.push([project, trigger]);
				return { state: "started" };
			},
		},
	});
});
after(() => srv.close());

let opened;
beforeEach(() => {
	started.length = 0;
	for (const f of ["answers.jsonl", "asks.jsonl", "journal.jsonl"])
		fs.rmSync(path.join(process.env.RUSUBAN_HOME, "projects/demo", f), { force: true });
	write("projects/demo/live.json", {
		repos: { "o/r": { defaultBranch: "main", prs: live.prs, issues: live.issues } },
	});
	const judgment = { items: {} };
	opened = toAlice(judgment);
	write("projects/demo/judgment.json", judgment);
});

function call(method, urlPath, body) {
	return new Promise((resolve, reject) => {
		const headers = {
			origin: `http://127.0.0.1:${srv.port}`,
			"x-rusuban": "1",
			"content-type": "application/json",
		};
		const req = http.request(
			{ host: "127.0.0.1", port: srv.port, method, path: urlPath, headers },
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (c) => {
					text += c;
					if (res.headers["content-type"] === "text/event-stream" && /event: inbox/.test(text))
						res.destroy();
				});
				res.on("close", () =>
					resolve({ status: res.statusCode, body: text.startsWith("{") ? JSON.parse(text) : text }),
				);
			},
		);
		req.on("error", reject);
		if (body !== undefined) req.write(JSON.stringify(body));
		req.end();
	});
}
const answer = (over = {}) =>
	call("POST", "/api/answer", {
		project: "demo",
		item: "#10",
		card: opened.id,
		option: "build",
		...over,
	});

test("an answer is recorded once and starts the coordinator at once", async () => {
	const first = await answer();
	assert.deepEqual([first.status, first.body], [200, { ok: true, coordinator: "started" }]);
	assert.deepEqual(started, [["demo", "answer"]]);
	const [a] = readJsonl("projects/demo/answers.jsonl");
	assert.deepEqual([a.item, a.card, a.option, a.by], ["o/r#10", opened.id, "build", "alice"]);
	assert.match(readJsonl("projects/demo/journal.jsonl")[0].text, /^Answered: Build it/);
	const second = await answer({ option: "close" });
	assert.deepEqual([second.status, second.body.error], [409, "this card is already answered"]);
	assert.equal(readJsonl("projects/demo/answers.jsonl").length, 1);
	assert.equal(started.length, 1);
});

test("a replaced card, an unknown project, item or option are refused", async () => {
	const judgment = read("projects/demo/judgment.json");
	judgment.items["o/r#10"].decision.state = "replaced";
	write("projects/demo/judgment.json", judgment);
	assert.equal((await answer()).status, 409);
	assert.equal((await answer({ project: "nope" })).status, 404);
	assert.equal((await answer({ item: "x/y#1" })).status, 400);
	assert.equal((await answer({ item: "garbage" })).status, 400);
	assert.deepEqual(readJsonl("projects/demo/answers.jsonl"), []);
	assert.deepEqual(started, []);
});

test("a request is recorded and starts the coordinator; an empty one is refused", async () => {
	const ok = await call("POST", "/api/ask", {
		project: "demo",
		text: " Close the stale issues. ",
		item: "#10",
	});
	assert.deepEqual([ok.status, ok.body.coordinator], [200, "started"]);
	const [ask] = readJsonl("projects/demo/asks.jsonl");
	assert.deepEqual([ask.text, ask.item, ask.by], ["Close the stale issues.", "o/r#10", "alice"]);
	assert.deepEqual(started, [["demo", "ask"]]);
	assert.equal((await call("POST", "/api/ask", { project: "demo", text: "  " })).status, 400);
});

test("the inbox serves the waiting cards and the owner's flags, also on the live stream", async () => {
	append("projects/demo/journal.jsonl", {
		at: new Date().toISOString(),
		kind: "direct-push",
		item: null,
		text: "Pushed straight to main",
		by: "server",
		notify: true,
	});
	const inbox = (await call("GET", "/api/inbox")).body;
	assert.deepEqual(
		inbox.cards.map((c) => [c.project, c.item, c.card.id, c.answer]),
		[["demo", "o/r#10", opened.id, null]],
	);
	assert.deepEqual(
		inbox.flags.map((f) => [f.project, f.kind]),
		[["demo", "direct-push"]],
	);
	const events = await call("GET", "/api/events?project=demo");
	assert.match(events.body, /event: state\n[\s\S]*event: inbox\ndata: \{"cards":/);
});

test("runs are listed at work first, and a queued or running one can be stopped", async () => {
	const run = (id, state, createdAt, extra = {}) =>
		write(`runs/${id}/status.json`, {
			id,
			kind: "judge",
			project: "demo",
			items: [],
			state,
			createdAt,
			lock: "demo.coordinator",
			...extra,
		});
	run("judge-done", "done", "2026-11-07T12:00:00Z", { summary: "Judged 3 PRs.", session: "s-1" });
	run("judge-queued", "queued", "2026-11-07T11:00:00Z");
	run("judge-running", "running", "2026-11-07T10:00:00Z", { pid: process.pid });
	const { runs } = (await call("GET", "/api/runs?project=demo")).body;
	assert.deepEqual(
		runs.map((r) => r.id),
		["judge-running", "judge-queued", "judge-done"],
	);
	assert.equal(runs[2].conversation, "s-1");
	const stopped = await call("POST", "/api/runs/judge-queued/stop");
	assert.deepEqual([stopped.status, stopped.body.state], [200, "stopped"]);
	assert.match(readJsonl("projects/demo/journal.jsonl").at(-1).text, /^Stopped the judge run/);
	assert.equal((await call("POST", "/api/runs/judge-done/stop")).status, 409);
	assert.equal((await call("POST", "/api/runs/nope/stop")).status, 404);
});

test("a state file the model cannot read costs the page an update, never the daemon nor a write", async () => {
	const client = { res: { write: () => {} }, project: "demo", sent: "", sentInbox: "" };
	srv.ctx.clients.add(client);
	try {
		write("projects/demo/live.json", {
			repos: { "o/r": { prs: [{ repo: "o/r", n: 1 }], issues: [] } },
		});
		assert.doesNotThrow(() => srv.ctx.broadcast(true));
		const ok = await call("POST", "/api/ask", { project: "demo", text: "Still recorded." });
		assert.equal(ok.status, 200);
		assert.equal(readJsonl("projects/demo/asks.jsonl").at(-1).text, "Still recorded.");
	} finally {
		srv.ctx.clients.delete(client);
	}
});

test("what the agents did may be a list of steps, each with the link that shows it", () => {
	const steps = [
		{ text: "Rebased it on main.", href: "run:worker-1", label: "Conversation" },
		{ text: "Asked the author for a Linux check.", href: "https://github.com/o/r/pull/1#c-1" },
		"Read the whole thread.",
	];
	const judgment = { items: {} };
	assert.deepEqual(toAlice(judgment, { done: steps }).done, steps);
	for (const done of [[], [{ href: "run:x" }], [{ text: "x", href: "javascript:alert(1)" }]])
		assert.throws(() => toAlice({ items: {} }, { done }), /decision.done/);
	const [entry] = inboxOf([{ id: "p", live, judgment }]);
	assert.deepEqual(
		[entry.kind, entry.author, entry.judgedBy, entry.evidence],
		["feature", null, null, null],
	);
});
