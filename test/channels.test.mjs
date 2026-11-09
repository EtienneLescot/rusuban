// Channels (T065) and the pings wired into the daemon: a channel added waits for the owner (data
// leaves to its target, FR-092), its secret never shows, `channel test` really sends, and the daemon
// pings each card once.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, read, saveConfig, validateConfig, write } from "../src/home.mjs";
import { applyJudgment } from "../src/model.mjs";
import { cardUrl } from "../src/pings.mjs";
import { flagsToPing, pingBase, pingOnce, reloadConfig, startServer } from "../src/server.mjs";
import { confirmRequest, pendingRequests } from "../src/settings.mjs";

const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));
const config = (over = {}) => ({
	version: 1,
	owner: { login: "alice" },
	port: 0,
	permissions: { mode: "allowlist" },
	limits: { maxWorkers: 1, maxRunMinutes: 10 },
	projects: [{ id: "demo", mode: "shadow", repos: [{ slug: "o/r" }] }],
	...over,
});
beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-channels-"));
	saveConfig(config());
});
const cli = (...args) =>
	new Promise((resolve) =>
		execFile(process.execPath, [BIN, ...args], { encoding: "utf8" }, (e, stdout, stderr) =>
			resolve({ status: e ? e.code : 0, stdout, stderr }),
		),
	);

test("a channel's config is checked: its type, its target, its urgency, an e-mail's server", () => {
	const bad = (ch) => () => validateConfig(config({ channels: [ch] }));
	const ok = { id: "ntfy", type: "ntfy", target: "https://ntfy.sh/x", urgency: ["now"] };
	assert.equal(validateConfig(config({ channels: [ok] })).channels.length, 1);
	assert.throws(bad({ ...ok, type: "pager" }), /type must be ntfy, slack, discord, teams, email/);
	assert.throws(bad({ ...ok, urgency: ["soon"] }), /urgency must list now, digest or both/);
	assert.throws(bad({ ...ok, type: "email", target: "a@b.c" }), /needs its smtp server/);
	assert.throws(() => validateConfig(config({ channels: [ok, ok] })), /"ntfy" is used twice/);
	assert.throws(bad({ ...ok, token: "" }), /token must be the topic's access token/);
	assert.equal(validateConfig(config({ channels: [{ ...ok, token: "tk_1" }] })).channels.length, 1);
});

test("flags ping: rules, a bypass turned on, a foreign merge or push at once; the rest in the digest", () => {
	const at = "2026-11-08T10:00:00.000Z";
	const flag = (kind, over = {}) => ({ project: "demo", at, kind, text: kind, ...over });
	const pinged = flagsToPing(
		[
			flag("rules", { href: "https://github.com/o/r/tree/abc/.rusuban" }),
			flag("foreign-merge", { item: "#3" }),
			flag("direct-push"),
			flag("setting", { setting: "project.bypass" }),
			flag("merge-refused"),
			flag("setting", { project: null, setting: "limits" }),
			flag("ping-failed"),
		],
		"alice",
		"http://127.0.0.1:8790",
	);
	assert.deepEqual(
		pinged.map((e) => [e.card.q, e.card.urgency]),
		[
			["rules", "now"],
			["foreign-merge", "now"],
			["direct-push", "now"],
			["setting", "now"],
			["merge-refused", "digest"],
			["setting", "digest"],
		],
		"a failed ping never pings, or a broken channel loops",
	);
	assert.equal(pinged[0].href, "https://github.com/o/r/tree/abc/.rusuban");
	assert.equal(pinged[1].href, "http://127.0.0.1:8790/");
	assert.equal(pinged[5].card.id, `flag:instance:${at}:setting`);
	assert.ok(pinged.every((e) => e.card.to === "alice" && e.card.createdAt === at));
});

test("a channel waits for the owner, its secret never shows; a test really sends; removing is at once", async () => {
	const got = [];
	const ntfy = http.createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			got.push({ url: req.url, title: req.headers.title, body });
			res.end("ok");
		});
	});
	await new Promise((r) => ntfy.listen(0, "127.0.0.1", r));
	const target = `http://127.0.0.1:${ntfy.address().port}/secret-topic`;
	try {
		const asked = await cli("channel", "add", "ntfy", target, "--urgency", "now");
		assert.match(
			asked.stdout,
			/^Send your cards to ntfy, 127\.0\.0\.1:\d+\/…\?\nIt waits for your confirmation/,
		);
		assert.ok(!asked.stdout.includes("secret-topic"), "the topic is the secret");
		assert.deepEqual(loadConfig().channels, []);
		confirmRequest(pendingRequests()[0].id, { allow: true, by: "alice" });
		const list = JSON.parse((await cli("channel", "list")).stdout);
		assert.deepEqual(
			list.map((c) => [c.id, c.type, c.urgency]),
			[["ntfy", "ntfy", ["now"]]],
		);
		assert.ok(!JSON.stringify(list).includes("secret-topic"));
		const sent = await cli("channel", "test", "ntfy");
		assert.equal(sent.status, 0, sent.stderr);
		assert.match(sent.stdout, /^channel ntfy: a test went to 127\.0\.0\.1:\d+\/…\./);
		assert.equal(got[0].url, "/secret-topic");
		assert.match(got[0].body + got[0].title, /A test from Rusuban/);
		assert.match((await cli("channel", "remove", "ntfy")).stdout, /^channel ntfy removed\./);
		assert.deepEqual(read("config.json").channels, []);
		assert.match((await cli("channel", "test", "ntfy")).stderr, /no channel "ntfy"/);
	} finally {
		ntfy.close();
	}
});

test("`channel test` links where the daemon's pings do: on the tailnet once remote access is on", async () => {
	const remote = config({ port: 8790, owner: { login: "alice", tailscaleLogin: "a@example.com" } });
	assert.equal(await pingBase(remote, async () => "box.tail1.ts.net"), "https://box.tail1.ts.net");
	assert.equal(await pingBase(remote, async () => null), "http://127.0.0.1:8790", "Tailscale down");
	const off = await pingBase(config({ port: 8790 }), () => assert.fail("Tailscale is not asked"));
	assert.equal(off, "http://127.0.0.1:8790");
});

test("the daemon pings a new card once, by its urgency, linked on the tailnet, and keeps its state", async () => {
	const channels = [
		{ id: "ntfy", type: "ntfy", target: "https://ntfy.example/t", urgency: ["now"] },
	];
	saveConfig(config({ channels }));
	const sent = [];
	const srv = await startServer({
		port: 0,
		polling: false,
		quiet: true,
		tailnet: "box.tail1.ts.net",
		deps: {
			sendPing: async (channel, message) => sent.push([channel.id, message.title, message.href]),
		},
	});
	try {
		// A new channel does not replay the inbox: what comes after its first call pings.
		await pingOnce(srv.ctx);
		// The owner allows remote access while the daemon runs: the next pings link on the tailnet.
		saveConfig(config({ channels, owner: { login: "alice", tailscaleLogin: "a@example.com" } }));
		reloadConfig(srv.ctx);
		const live = { prs: [], issues: [{ repo: "o/r", n: 10, title: "Dark mode" }] };
		const judgment = { items: {} };
		applyJudgment(
			{
				item: "#10",
				label: "Dark mode",
				kind: "feature",
				owner: "alice",
				next: "Alice decides.",
				decision: {
					urgency: "now",
					done: "I read it.",
					q: "Build dark mode?",
					ctx: "Asked twice.",
					rec: "yes",
					why: "Wanted.",
					options: [
						{ id: "yes", label: "Build it", effect: "I open a PR." },
						{ id: "no", label: "Close it", effect: "I close it." },
					],
				},
			},
			live,
			judgment,
			{ repos: ["o/r"] },
		);
		write("projects/demo/judgment.json", judgment);
		write("projects/demo/live.json", { repos: { "o/r": { prs: [], issues: live.issues } } });
		await pingOnce(srv.ctx);
		await pingOnce(srv.ctx);
		const link = cardUrl("https://box.tail1.ts.net", judgment.items["o/r#10"].decision.id);
		assert.deepEqual(sent, [["ntfy", "Build dark mode?", link]]);
		assert.ok(Object.keys(read("pings.json").channels.ntfy.done).length === 1);
		srv.ctx.dry = true;
		await pingOnce(srv.ctx);
		assert.equal(sent.length, 1, "a dry daemon pings no one");
	} finally {
		await srv.close();
	}
});
