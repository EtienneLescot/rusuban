// Pings (T062, T063, T064, T107): one payload per channel type, each with its card's link; the
// dispatch by urgency, digest time and quiet hours; a failed send tried again, then journaled.
// Nothing leaves the machine: the dispatch sends to a recorder, the sender to a local server and to
// nodemailer's JSON transport.
import "./tmp-root.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { cardUrl, dashboardUrl, dispatch, messageOf, PAYLOADS, sendPing } from "../src/pings.mjs";

// Local times on fixed days of November 2026, as quiet hours and digest times are written.
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m).getTime();
const iso = (t) => new Date(t).toISOString();

const TAILNET = "pilot.tail1234.ts.net";
const BASE = `https://${TAILNET}`;
const OWNER = { login: "octo", tailscaleLogin: "octo@example.com" };
// An inbox entry (model.mjs inboxOf) with its open card.
const entry = (
	n,
	{ urgency = "now", createdAt = iso(at(9, 10)), to = "octo", q, answer } = {},
) => ({
	project: "alpha",
	item: `o/r#${n}`,
	label: `Change ${n}`,
	card: { id: `o/r#${n}@${n}-ab12`, to, urgency, q: q ?? `Merge #${n}?`, createdAt },
	answer: answer ?? null,
});
const LINK = cardUrl(BASE, "o/r#1@1-ab12");
const message = (entries) => messageOf(entries, { base: BASE, owner: "octo" });
const ONE = message([entry(1)]);
const FRENCH = "Fusionner l’export ?";
const encoded = (s) => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;

test("a ping links straight to its card, on the tailnet when remote access is on", () => {
	assert.equal(LINK, `${BASE}/#card/o%2Fr%231%401-ab12`);
	// The page reads the id back from its address (web/app.js).
	assert.equal(decodeURIComponent(new URL(LINK).hash.slice("#card/".length)), "o/r#1@1-ab12");
	assert.equal(dashboardUrl({ owner: OWNER, port: 8788, tailnet: TAILNET }), BASE);
	// Remote access off (no Tailscale login stored), or Tailscale down: the host's address.
	const local = "http://127.0.0.1:8788";
	assert.equal(dashboardUrl({ owner: { login: "octo" }, port: 8788, tailnet: TAILNET }), local);
	assert.equal(dashboardUrl({ owner: OWNER, port: 8788, tailnet: null }), local);
});

test("a digest is one message: a line and a link per card, the inbox as its own link", () => {
	const m = message([entry(1), entry(2, { to: "alice" })]);
	assert.equal(m.title, "2 decisions wait for you");
	assert.equal(m.href, `${BASE}/`);
	assert.deepEqual(m.lines, [
		{ text: "Merge #1? (Change 1 · o/r#1)", href: LINK },
		// In v1 every card goes to the owner; one meant for another login says so (FR-045).
		{ text: "Merge #2? (Change 2 · o/r#2 · for @alice)", href: cardUrl(BASE, "o/r#2@2-ab12") },
	]);
	// Discord takes ten embeds: past ten cards, the last line opens the inbox.
	const many = message(Array.from({ length: 12 }, (_, i) => entry(i + 1)));
	assert.equal(many.lines.length, 10);
	assert.deepEqual(many.lines.at(-1), { text: "and 3 more in the inbox", href: `${BASE}/` });
});

test("ntfy: a POST to the topic, the question as Title, the card as Click", () => {
	const p = PAYLOADS.ntfy({ type: "ntfy", target: "https://ntfy.sh/topic" }, ONE);
	assert.equal(p.url, "https://ntfy.sh/topic");
	assert.deepEqual(p.headers, { Title: "Merge #1?", Click: LINK });
	assert.equal(p.body, `Change 1 · o/r#1\n${LINK}`);
	// A header is ASCII on the wire: any other title goes as an RFC 2047 word.
	const accents = PAYLOADS.ntfy(
		{ target: "https://ntfy.sh/topic" },
		message([entry(1, { q: FRENCH })]),
	);
	assert.equal(accents.headers.Title, encoded(FRENCH));
	// A protected topic: its access token goes as a bearer, and only when there is one.
	const locked = PAYLOADS.ntfy({ target: "https://ntfy.sh/topic", token: "tk_1" }, ONE);
	assert.equal(locked.headers.Authorization, "Bearer tk_1");
	assert.ok(!("Authorization" in p.headers));
});

test("Slack: blocks whose link opens the card, the card's text escaped", () => {
	const target = "https://hooks.slack.com/services/T0/B0/x";
	const p = PAYLOADS.slack(
		{ type: "slack", target },
		message([entry(1, { q: "Ship <!channel> & co?" })]),
	);
	assert.equal(p.url, target);
	const body = JSON.parse(p.body);
	assert.equal(body.text, "Ship &lt;!channel&gt; &amp; co?");
	assert.deepEqual(
		body.blocks.map((b) => b.text.text),
		["*Ship &lt;!channel&gt; &amp; co?*", `<${LINK}|Change 1 · o/r#1>`],
	);
});

test("Discord: an embed that opens the card, no mention parsed", () => {
	const target = "https://discord.com/api/webhooks/1/x";
	const p = PAYLOADS.discord({ type: "discord", target }, ONE);
	assert.equal(p.url, target);
	assert.deepEqual(JSON.parse(p.body), {
		content: "Merge #1?",
		embeds: [{ title: "Change 1 · o/r#1", url: LINK }],
		allowed_mentions: { parse: [] },
	});
});

test("Teams: a Workflows message carrying an Adaptive Card that opens the card", () => {
	const target =
		"https://prod-01.westeurope.logic.azure.com/workflows/x/triggers/manual/paths/invoke";
	const body = JSON.parse(PAYLOADS.teams({ type: "teams", target }, ONE).body);
	assert.equal(body.type, "message");
	const [card] = body.attachments;
	assert.equal(card.contentType, "application/vnd.microsoft.card.adaptive");
	assert.equal(card.content.type, "AdaptiveCard");
	assert.deepEqual(
		card.content.body.map((b) => b.text),
		["Merge #1?", `[Change 1 · o/r#1](${LINK})`],
	);
	assert.deepEqual(card.content.actions, [{ type: "Action.OpenUrl", title: "Open", url: LINK }]);
});

test("e-mail: to the channel's address, the question as subject, the link in the text", () => {
	const channel = {
		type: "email",
		target: "octo@example.com",
		smtp: "smtps://u:p@smtp.example.com",
	};
	assert.deepEqual(PAYLOADS.email(channel, ONE), {
		from: "octo@example.com",
		to: "octo@example.com",
		subject: "Merge #1?",
		text: `Change 1 · o/r#1\n${LINK}`,
	});
	assert.equal(
		PAYLOADS.email({ ...channel, from: "bot@example.com" }, ONE).from,
		"bot@example.com",
	);
});

test("the sender posts to the channel's URL, and a refusal throws without naming it", async (t) => {
	let status = 200;
	const got = [];
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			got.push({ method: req.method, url: req.url, headers: req.headers, body });
			res.writeHead(status).end(status === 200 ? "{}" : "no such topic");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.close();
		server.closeAllConnections();
	});
	const channel = {
		type: "ntfy",
		target: `http://127.0.0.1:${server.address().port}/secret-topic`,
	};
	const m = message([entry(1, { q: FRENCH })]);
	await sendPing(channel, m);
	assert.equal(got[0].method, "POST");
	assert.equal(got[0].url, "/secret-topic");
	assert.equal(got[0].headers.title, encoded(FRENCH));
	assert.equal(got[0].headers.click, LINK);
	assert.equal(got[0].body, `Change 1 · o/r#1\n${LINK}`);
	status = 404;
	await assert.rejects(sendPing(channel, m), (e) => {
		assert.equal(e.message, "HTTP 404 no such topic");
		return true;
	});
	await assert.rejects(sendPing({ type: "pager", target: "x" }, m), /no channel type "pager"/);
});

test("e-mail goes out through nodemailer, here its JSON transport that sends nothing", async () => {
	const channel = { type: "email", target: "octo@example.com", smtp: { jsonTransport: true } };
	const sent = JSON.parse((await sendPing(channel, ONE)).message);
	assert.equal(sent.subject, "Merge #1?");
	assert.deepEqual(sent.to, [{ address: "octo@example.com", name: "" }]);
	assert.equal(sent.text, `Change 1 · o/r#1\n${LINK}`);
	await assert.rejects(sendPing({ ...channel, smtp: undefined }, ONE), /needs its smtp server/);
});

// ── Dispatch ──────────────────────────────────────────────────────────────────────────────────
const CONFIG = {
	owner: OWNER,
	port: 8788,
	channels: [
		{ id: "phone", type: "ntfy", target: "https://ntfy.sh/t", urgency: ["now"] },
		{
			id: "mail",
			type: "email",
			target: "octo@example.com",
			urgency: ["digest"],
			digestAt: "18:00",
		},
	],
};
// One dispatch, its sends and journal entries recorded; with `fail`, every send throws.
async function run(cards, now, { state, config = CONFIG, fail = false } = {}) {
	const sent = [];
	const journaled = [];
	const next = await dispatch(
		{ config, cards, state, now, tailnet: TAILNET },
		{
			send: async (channel, m) => {
				sent.push({ channel: channel.id, title: m.title, m });
				if (fail) throw new Error("HTTP 503 unavailable");
			},
			journal: (project, e) => journaled.push({ project, ...e }),
		},
	);
	return { state: next, sent, journaled };
}
const titles = (r) => r.sent.map((s) => [s.channel, s.title]);

test("a new card goes to the channels of its urgency, once, linked on the tailnet", async () => {
	const { state } = await run([], at(9, 8)); // the channels' first dispatch
	const cards = [entry(1), entry(2, { urgency: "digest" })];
	let r = await run(cards, at(9, 10, 1), { state });
	assert.deepEqual(titles(r), [["phone", "Merge #1?"]]);
	assert.equal(r.sent[0].m.href, LINK);
	r = await run(cards, at(9, 10, 2), { state });
	assert.deepEqual(r.sent, []);
});

test("every card goes to the owner; an answered one, or one older than the channel, does not ping", async () => {
	const old = entry(1, { createdAt: iso(at(9, 7)) });
	const first = await run([old], at(9, 8)); // a new channel does not replay the inbox
	assert.deepEqual(first.sent, []);
	const state = first.state;
	const cards = [old, entry(2, { to: "alice" }), entry(3, { answer: { option: "build" } })];
	const r = await run(cards, at(9, 10, 1), { state });
	assert.deepEqual(titles(r), [["phone", "Merge #2?"]]);
	assert.equal(r.sent[0].m.lines[0].text, "Change 2 · o/r#2 · for @alice");
});

test("cards that can wait go together at the channel's digest time", async () => {
	const { state } = await run([], at(9, 8));
	const cards = [
		entry(1, { urgency: "digest" }),
		entry(2, { urgency: "digest", createdAt: iso(at(9, 15)) }),
	];
	let r = await run(cards, at(9, 17, 59), { state });
	assert.deepEqual(r.sent, []);
	r = await run(cards, at(9, 18), { state });
	assert.deepEqual(titles(r), [["mail", "2 decisions wait for you"]]);
	// One that comes after the digest waits for the next.
	const late = entry(3, { urgency: "digest", createdAt: iso(at(9, 18, 5)) });
	r = await run([...cards, late], at(9, 23), { state });
	assert.deepEqual(r.sent, []);
	r = await run([...cards, late], at(10, 18, 1), { state });
	assert.deepEqual(titles(r), [["mail", "Merge #3?"]]);
});

test("quiet hours hold what can wait, never an urgent card", async () => {
	const phone = {
		id: "phone",
		type: "ntfy",
		target: "https://ntfy.sh/t",
		quietHours: "22:00-08:00",
	};
	const config = { ...CONFIG, channels: [{ ...phone, urgency: ["now", "digest"] }] };
	const { state } = await run([], at(9, 20), { config });
	const night = [
		entry(1, { urgency: "digest", createdAt: iso(at(9, 23)) }),
		entry(2, { urgency: "digest", createdAt: iso(at(10, 1)) }),
	];
	const urgent = entry(3, { createdAt: iso(at(10, 2)) });
	let r = await run([...night, urgent], at(10, 2, 1), { state, config });
	assert.deepEqual(titles(r), [["phone", "Merge #3?"]]);
	r = await run([...night, urgent], at(10, 7, 59), { state, config });
	assert.deepEqual(r.sent, []);
	r = await run([...night, urgent], at(10, 8), { state, config });
	assert.deepEqual(titles(r), [["phone", "2 decisions wait for you"]]);
	// Outside quiet hours, and with no digest time, one that can wait goes as it comes.
	const day = entry(4, { urgency: "digest", createdAt: iso(at(10, 12)) });
	r = await run([...night, urgent, day], at(10, 12, 1), { state, config });
	assert.deepEqual(titles(r), [["phone", "Merge #4?"]]);
});

test("a failed send is tried again after 1 then 5 minutes, then journaled for the owner", async () => {
	const { state } = await run([], at(9, 8));
	const card = entry(1);
	const t = at(9, 10, 1);
	const tries = async (now, fail = true) => (await run([card], now, { state, fail })).sent.length;
	assert.equal(await tries(t), 1);
	assert.equal(await tries(t + 59e3), 0);
	assert.equal(await tries(t + 60e3), 1);
	assert.equal(await tries(t + 359e3), 0);
	const r = await run([card], t + 360e3, { state, fail: true });
	assert.equal(r.sent.length, 1);
	assert.deepEqual(r.journaled, [
		{
			project: "alpha",
			kind: "ping-failed",
			item: "o/r#1",
			text: 'The ntfy ping "phone" failed 3 times: HTTP 503 unavailable. The card waits in the inbox.',
			card: "o/r#1@1-ab12",
			by: "server",
			notify: true,
		},
	]);
	assert.equal(await tries(t + 3600e3, false), 0); // given up
	// A send that works on its second try is done, and not journaled.
	const other = entry(2, { createdAt: iso(t + 3600e3) });
	await run([card, other], t + 3600e3, { state, fail: true });
	const ok = await run([card, other], t + 3660e3, { state });
	assert.deepEqual(titles(ok), [["phone", "Merge #2?"]]);
	assert.deepEqual(ok.journaled, []);
	assert.deepEqual((await run([card, other], t + 7200e3, { state })).sent, []);
});
