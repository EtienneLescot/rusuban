// Pings (FR-041, FR-045): a card reaches the owner on the channels they chose, by its urgency, with a
// link straight to it. Channels are outbound only: answers happen in the dashboard.
//
// The payloads turn one message into what each channel type takes (research R8). The dispatch picks
// what each channel sends: an urgent card at once, quiet hours or not; the others together, at the
// channel's `digestAt` and never in its quiet hours (US2 scenario 3). A failed send is tried again,
// then journaled for the owner. It takes its inputs (config, cards, state, now) and its effects
// (send, journal), so it runs without the network and without the server.
//
// A channel (data-model.md): `{ id, type, target, urgency: ["now", "digest"], quietHours?,
// digestAt? }`; `target` is the URL to POST to, or the address of an e-mail channel, which also
// needs `smtp`, its server as nodemailer takes it (`smtps://user:password@host:465`), and may name
// `from`, the address itself when unset.
import { journal as writeJournal } from "./home.mjs";
import { lastSlot } from "./tasks.mjs";

// ── Links (T107) ──────────────────────────────────────────────────────────────────────────────
// The dashboard as a ping links to it: on the tailnet when remote access is on (`remote enable`
// stored the owner's Tailscale login, and Tailscale names this machine), else on the host, where
// only the host opens it.
export const dashboardUrl = ({ owner, port, tailnet = null }) =>
	owner?.tailscaleLogin && tailnet ? `https://${tailnet}` : `http://127.0.0.1:${port}`;
// The page opens the card its address names (`#card/<id>`, web/app.js).
export const cardUrl = (base, id) => `${base}/#card/${encodeURIComponent(id)}`;

// ── Messages ──────────────────────────────────────────────────────────────────────────────────
const MAX_LINES = 10; // Discord takes ten embeds at most
// One line, read on a lock screen: whitespace folded, 200 characters at most.
const short = (s) => {
	const one = String(s ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return one.length > 200 ? `${one.slice(0, 199)}…` : one;
};

// One ping, from one card or several sent together. Its title is what a lock screen shows; each
// line links its card; its own link is the card's, or the inbox's for several. `entries` come from
// the inbox (model.mjs inboxOf). In v1 every card goes to the owner; one meant for another login
// says so (FR-045).
export function messageOf(entries, { base, owner }) {
	const about = (e) =>
		[e.label, e.item, e.card.to && e.card.to !== owner && `for @${e.card.to}`]
			.filter(Boolean)
			.join(" · ");
	if (entries.length === 1) {
		const [e] = entries;
		const href = e.href ?? cardUrl(base, e.card.id);
		return { title: short(e.card.q), href, lines: [{ text: short(about(e)), href }] };
	}
	const inbox = `${base}/`;
	const lines = entries.map((e) => ({
		text: short(`${e.card.q} (${about(e)})`),
		href: e.href ?? cardUrl(base, e.card.id),
	}));
	if (lines.length > MAX_LINES)
		lines.splice(MAX_LINES - 1, Number.POSITIVE_INFINITY, {
			text: `and ${entries.length - MAX_LINES + 1} more in the inbox`,
			href: inbox,
		});
	return { title: `${entries.length} decisions wait for you`, href: inbox, lines };
}

// ── Payloads (T062, research R8) ──────────────────────────────────────────────────────────────
const plain = (m) => m.lines.map((l) => `${l.text}\n${l.href}`).join("\n\n");
// Slack reads &, < and > as markup: escaped, a card's text can neither mention @channel nor hide a
// link.
const slackText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (url, value) => ({
	url,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(value),
});

export const PAYLOADS = {
	// ntfy.sh or a server of one's own: a POST to the topic's URL. A header is ASCII on the wire, so a
	// title that is not goes as an RFC 2047 word, which ntfy decodes.
	ntfy: (c, m) => ({
		url: c.target,
		headers: {
			Title: /^[\x20-\x7e]*$/.test(m.title)
				? m.title
				: `=?UTF-8?B?${Buffer.from(m.title).toString("base64")}?=`,
			Click: m.href,
			// A protected topic (an ntfy server of one's own, or a reserved topic) takes a token.
			...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
		},
		body: plain(m),
	}),
	// A Slack incoming webhook, in blocks; `text` is what the notification shows.
	slack: (c, m) =>
		json(c.target, {
			text: slackText(m.title),
			blocks: [
				{ type: "section", text: { type: "mrkdwn", text: `*${slackText(m.title)}*` } },
				...m.lines.map((l) => ({
					type: "section",
					text: { type: "mrkdwn", text: `<${l.href}|${slackText(l.text)}>` },
				})),
			],
		}),
	// A Discord webhook: an embed per line. No card's text pings anyone (@everyone).
	discord: (c, m) =>
		json(c.target, {
			content: m.title,
			embeds: m.lines.map((l) => ({ title: l.text, url: l.href })),
			allowed_mentions: { parse: [] },
		}),
	// A Teams Workflows webhook ("Send webhook alerts to a channel") posts the Adaptive Card it is sent;
	// the Office 365 connectors are gone since May 2026.
	teams: (c, m) =>
		json(c.target, {
			type: "message",
			attachments: [
				{
					contentType: "application/vnd.microsoft.card.adaptive",
					contentUrl: null,
					content: {
						$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
						type: "AdaptiveCard",
						version: "1.2",
						body: [
							{ type: "TextBlock", text: m.title, weight: "bolder", wrap: true },
							...m.lines.map((l) => ({
								type: "TextBlock",
								text: `[${l.text.replace(/[[\]]/g, "")}](${l.href})`,
								wrap: true,
							})),
						],
						actions: [{ type: "Action.OpenUrl", title: "Open", url: m.href }],
					},
				},
			],
		}),
	// E-mail, the message nodemailer sends.
	email: (c, m) => ({ from: c.from ?? c.target, to: c.target, subject: m.title, text: plain(m) }),
};

// ── Sending ───────────────────────────────────────────────────────────────────────────────────
// Delivers one message on one channel, or throws. nodemailer loads only when an e-mail goes out. An
// error never names the target: webhook URLs and topics are secrets, and the error is journaled.
export async function sendPing(channel, message) {
	const build = PAYLOADS[channel.type];
	if (!build) throw new Error(`no channel type "${channel.type}"`);
	const payload = build(channel, message);
	if (channel.type === "email") {
		if (!channel.smtp) throw new Error("an e-mail channel needs its smtp server");
		const { default: nodemailer } = await import("nodemailer");
		return nodemailer.createTransport(channel.smtp).sendMail(payload);
	}
	let res;
	try {
		res = await fetch(payload.url, {
			method: "POST",
			headers: payload.headers,
			body: payload.body,
			signal: AbortSignal.timeout(10_000),
		});
	} catch (e) {
		throw new Error(e.cause?.message || e.cause?.code || e.message);
	}
	if (!res.ok) {
		const said = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status} ${said.slice(0, 200)}`.trim());
	}
}

// ── Dispatch (T064) ───────────────────────────────────────────────────────────────────────────
const RETRY_MIN = [1, 5]; // before the second and the third try; a third failure is journaled
// "18:00" → [18, 0], or null.
const hm = (s) => {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
	return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? [Number(m[1]), Number(m[2])] : null;
};
// Quiet hours, "22:00-08:00" in local time as written; a window may cross midnight.
function inQuiet(hours, now) {
	const [from, to] = String(hours ?? "")
		.split("-")
		.map(hm);
	if (!from || !to) return false;
	const d = new Date(now);
	const t = d.getHours() * 60 + d.getMinutes();
	const [a, b] = [from[0] * 60 + from[1], to[0] * 60 + to[1]];
	return a <= b ? t >= a && t < b : t >= a || t < b;
}

// Whether a channel sends a card now: one of its urgencies, not answered, not sent yet, not waiting
// to be tried again. An urgent card goes at once; the others wait for a `digestAt` passed since they
// came, and for the end of quiet hours. A card older than the channel's first dispatch never pings
// on it: a new channel does not replay the inbox.
function isDue(channel, mine, e, now) {
	const d = e.card;
	if (e.answer || mine.done[d.id] || !channel.urgency?.includes(d.urgency)) return false;
	const created = Date.parse(d.createdAt);
	if (!(created >= Date.parse(mine.since)) || Date.parse(mine.tries[d.id]?.next) > now)
		return false;
	if (d.urgency === "now") return true;
	if (inQuiet(channel.quietHours, now)) return false;
	const at = hm(channel.digestAt);
	return !at || lastSlot([at], now) >= created;
}

// Sends what is due on every channel of the config, one message per channel, and returns the state,
// changed in place. The caller keeps it between calls (one writer, the daemon) and never runs two
// dispatches at once. Per channel: `since`, its first dispatch; `done`, the cards it sent or gave up
// on; `tries`, the cards that failed and when to try them again.
export async function dispatch(
	{ config, cards, state = {}, now = Date.now(), port = config.port, tailnet = null },
	{ send = sendPing, journal = writeJournal } = {},
) {
	const at = new Date(now).toISOString();
	const base = dashboardUrl({ owner: config.owner, port, tailnet });
	const before = state.channels ?? {};
	state.channels = {}; // a channel removed from the config leaves nothing behind
	await Promise.all(
		config.channels.map(async (channel) => {
			const mine = before[channel.id] ?? { since: at, done: {}, tries: {} };
			state.channels[channel.id] = mine;
			const due = cards.filter((e) => isDue(channel, mine, e, now));
			if (!due.length) return;
			try {
				await send(channel, messageOf(due, { base, owner: config.owner.login }));
				for (const e of due) {
					mine.done[e.card.id] = at;
					delete mine.tries[e.card.id];
				}
			} catch (err) {
				const reason = String(err?.message ?? err).split("\n")[0];
				for (const e of due) {
					const n = (mine.tries[e.card.id]?.n ?? 0) + 1;
					if (n <= RETRY_MIN.length) {
						mine.tries[e.card.id] = {
							n,
							next: new Date(now + RETRY_MIN[n - 1] * 60e3).toISOString(),
						};
						continue;
					}
					mine.done[e.card.id] = at;
					delete mine.tries[e.card.id];
					journal(e.project, {
						kind: "ping-failed",
						item: e.item,
						text: `The ${channel.type} ping "${channel.id}" failed ${n} times: ${reason}. The card waits in the inbox.`,
						card: e.card.id,
						by: "server",
						notify: true,
					});
				}
			}
		}),
	);
	return state;
}
