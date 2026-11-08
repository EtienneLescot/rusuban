// The owner's settings (US9, T118, T119): one module for the owner's commands and the MCP. What widens
// agents' rights waits for the owner's card unless a person confirmed it in a terminal; what narrows
// applies at once; every change is journaled with its origin; nothing runs inside an agent run.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { loadConfig, read, saveConfig, write } from "../src/home.mjs";
import { startServer } from "../src/server.mjs";
import {
	changeSetting,
	confirmRequest,
	pendingRequests,
	planOf,
	settingsCards,
	settingsLog,
	tailscale,
} from "../src/settings.mjs";

beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-settings-"));
	delete process.env.RUSUBAN_RUN;
	saveConfig({
		version: 1,
		owner: { login: "alice" },
		port: 0,
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 1, maxRunMinutes: 10 },
		projects: [
			{ id: "live", mode: "live", repos: [{ slug: "o/live" }] },
			{ id: "calm", mode: "shadow", repos: [{ slug: "o/calm" }] },
		],
	});
});
const as = { origin: "cli", by: "alice" };

test("what widens agents' rights, and what narrows them", () => {
	const widens = (change) => {
		const plan = planOf(loadConfig(), change);
		return plan.same ? "same" : plan.widens;
	};
	assert.equal(widens({ kind: "project.add", slug: "o/new" }), false);
	assert.equal(widens({ kind: "project.add", slug: "o/two", to: "live" }), true);
	assert.equal(widens({ kind: "project.add", slug: "o/two", to: "calm" }), false);
	assert.equal(widens({ kind: "project.mode", project: "calm", mode: "live" }), true);
	assert.equal(widens({ kind: "project.mode", project: "live", mode: "shadow" }), false);
	assert.equal(widens({ kind: "project.mode", project: "live", mode: "live" }), "same");
	assert.equal(widens({ kind: "project.bypass", project: "live", on: true }), true);
	assert.equal(widens({ kind: "permissions.mode", mode: "bypass" }), true);
	assert.equal(widens({ kind: "project.remove", project: "calm" }), false);
	assert.throws(
		() => widens({ kind: "project.mode", project: "nope", mode: "live" }),
		/no project "nope"/,
	);
	assert.throws(() => widens({ kind: "owner.change" }), /unknown setting/);
});

test("narrowing applies at once; widening waits as a card; a terminal's typed confirmation applies it", () => {
	assert.equal(
		changeSetting({ kind: "project.mode", project: "live", mode: "shadow" }, as).state,
		"applied",
	);
	assert.equal(loadConfig().projects[0].mode, "shadow");

	const asked = changeSetting(
		{ kind: "permissions.mode", mode: "bypass" },
		{ ...as, origin: "mcp" },
	);
	assert.equal(asked.state, "pending");
	assert.equal(
		loadConfig().permissions.mode,
		"allowlist",
		"nothing changes before the owner allows it",
	);
	assert.deepEqual(
		pendingRequests().map((r) => [r.id, r.origin, r.change.kind]),
		[[asked.id, "mcp", "permissions.mode"]],
	);

	const typed = changeSetting(
		{ kind: "project.mode", project: "calm", mode: "live" },
		{ ...as, origin: "terminal", confirmed: true },
	);
	assert.equal(typed.state, "applied");
	assert.equal(loadConfig().projects[1].mode, "live");
	assert.deepEqual(
		settingsLog().map((e) => [e.setting, e.origin, e.state, !!e.notify]),
		[
			["project.mode", "cli", "applied", false],
			["permissions.mode", "mcp", "pending", false],
			["project.mode", "terminal", "applied", true],
		],
	);
});

test("the owner allows or declines a setting's card; a card for what no longer exists says so", () => {
	const a = changeSetting({ kind: "project.bypass", project: "live", on: true }, as);
	const b = changeSetting({ kind: "project.mode", project: "calm", mode: "live" }, as);
	const c = changeSetting({ kind: "project.add", slug: "o/two", to: "live" }, as);
	assert.equal(confirmRequest(a.id, { allow: true, by: "alice" }).state, "confirmed");
	assert.equal(loadConfig().projects[0].bypassApproval, true);
	assert.equal(confirmRequest(b.id, { allow: false, by: "alice" }).state, "declined");
	assert.equal(loadConfig().projects[1].mode, "shadow");
	assert.throws(() => confirmRequest(b.id, { allow: true, by: "alice" }), /no such setting waits/);
	// The live project went away meanwhile: the card cannot be carried out, and it goes.
	changeSetting({ kind: "project.remove", project: "live" }, as);
	assert.throws(
		() => confirmRequest(c.id, { allow: true, by: "alice" }),
		(e) => e.status === 409,
	);
	assert.deepEqual(pendingRequests(), []);
	assert.deepEqual(
		settingsLog().map((e) => [e.setting, e.state]),
		[
			["project.bypass", "pending"],
			["project.mode", "pending"],
			["project.add", "pending"],
			["project.bypass", "confirmed"],
			["project.mode", "declined"],
			["project.remove", "applied"],
			["project.add", "declined"],
		],
	);
});

test("a setting's card: Allow it or Don't allow it, no recommendation, Claude told when it asked", () => {
	changeSetting({ kind: "project.bypass", project: "live", on: true }, { ...as, origin: "mcp" });
	const [card] = settingsCards(loadConfig());
	assert.deepEqual(
		[card.type, card.project, card.projectTitle, card.card.urgency, card.card.rec],
		["setting", "live", "live", "now", null],
	);
	assert.equal(card.card.q, "Let the server merge with your bypass on live?");
	assert.match(
		card.card.ctx,
		/^Asked from Claude, through the MCP, at \d\d:\d\d\. The bypass skips the required approval only/,
	);
	assert.deepEqual(
		card.card.options.map((o) => [o.id, o.label, o.effect]),
		[
			[
				"allow",
				"Allow it",
				"The server merges what passes every lock, without the approval. Each such merge is journaled.",
			],
			["deny", "Don't allow it", "Nothing changes. Claude is told."],
		],
	);
	assert.match(card.card.id, /^setting:/);
});

test("remote access: on waits for the owner, then Serve forwards the dashboard; off applies at once", () => {
	const real = tailscale.run;
	const calls = [];
	let status = {
		BackendState: "Running",
		Self: { DNSName: "box.tail1.ts.net.", UserID: 7 },
		User: { 7: { LoginName: "alice@example.com" } },
	};
	const fake = (args) => {
		calls.push(args.join(" "));
		return args[0] === "status" ? JSON.stringify(status) : "";
	};
	try {
		tailscale.run = fake;
		const asked = changeSetting({ kind: "remote", on: true }, as);
		assert.deepEqual(
			[asked.state, asked.text],
			["pending", "Open the dashboard to your tailnet, at https://box.tail1.ts.net/?"],
		);
		assert.deepEqual(calls, ["status --json"], "nothing is served before the owner allows it");
		confirmRequest(pendingRequests()[0].id, { allow: true, by: "alice" });
		assert.deepEqual(calls.slice(1), [
			"status --json",
			"serve --bg --https=443 http://127.0.0.1:0",
		]);
		assert.equal(loadConfig().owner.tailscaleLogin, "alice@example.com");
		assert.equal(changeSetting({ kind: "remote", on: true }, as).state, "unchanged");
		// Off: the login goes even when Tailscale does not answer, and with it every tailnet request.
		calls.length = 0;
		tailscale.run = (args) => {
			calls.push(args.join(" "));
			throw new Error("tailscaled is not running");
		};
		assert.equal(changeSetting({ kind: "remote", on: false }, as).state, "applied");
		assert.deepEqual(calls, ["serve --https=443 off"]);
		assert.equal(loadConfig().owner.tailscaleLogin, undefined);
		assert.throws(
			() => changeSetting({ kind: "remote", on: true }, as),
			/Tailscale does not answer/,
		);
		status = { BackendState: "NeedsLogin", Self: {}, User: {} };
		tailscale.run = fake;
		assert.throws(
			() => changeSetting({ kind: "remote", on: true }, as),
			/Tailscale is not logged in on this machine/,
		);
		assert.deepEqual(pendingRequests(), []);
	} finally {
		tailscale.run = real;
	}
});

test("nothing is set inside an agent run", () => {
	process.env.RUSUBAN_RUN = "act-1";
	try {
		assert.throws(
			() => changeSetting({ kind: "project.mode", project: "live", mode: "shadow" }, as),
			/never changed inside an agent run/,
		);
	} finally {
		delete process.env.RUSUBAN_RUN;
	}
	assert.throws(
		() =>
			changeSetting(
				{ kind: "project.mode", project: "live", mode: "shadow" },
				{ origin: "agent", by: "x" },
			),
		/unknown origin/,
	);
});

test("the dashboard: the card in the inbox, allowed by the owner, never answered in words", async () => {
	const asked = changeSetting({ kind: "project.mode", project: "calm", mode: "live" }, as);
	write("automerge.json", { armed: false });
	const srv = await startServer({ port: 0, polling: false, quiet: true, tailnet: null });
	const call = (method, urlPath, body) =>
		new Promise((resolve, reject) => {
			const req = http.request(
				{
					host: "127.0.0.1",
					port: srv.port,
					method,
					path: urlPath,
					headers: { origin: `http://127.0.0.1:${srv.port}`, "x-rusuban": "1" },
				},
				(res) => {
					let text = "";
					res.on("data", (c) => {
						text += c;
					});
					res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
				},
			);
			req.on("error", reject);
			if (body) req.write(JSON.stringify(body));
			req.end();
		});
	try {
		const { cards } = (await call("GET", "/api/inbox")).body;
		assert.deepEqual(
			cards.map((c) => [c.type, c.card.id]),
			[["setting", `setting:${asked.id}`]],
		);
		const answer = (over) =>
			call("POST", "/api/answer", {
				project: "calm",
				item: null,
				card: `setting:${asked.id}`,
				...over,
			});
		assert.equal((await answer({ option: "other", note: "yes please" })).status, 400);
		const allowed = await answer({ option: "allow" });
		assert.deepEqual([allowed.status, allowed.body.state], [200, "confirmed"]);
		assert.equal(srv.ctx.config.projects[1].mode, "live", "the daemon applied it at once");
		assert.equal((await answer({ option: "allow" })).status, 404);
		assert.deepEqual((await call("GET", "/api/inbox")).body.cards, []);
		// The change shows in the project's journal, flagged for the owner.
		const { journal } = (await call("GET", "/api/state?project=calm")).body;
		assert.match(journal[0].text, /^Allowed by @alice: project calm is live/);
		assert.equal(read("config.json").projects[1].mode, "live");
	} finally {
		await srv.close();
	}
});
