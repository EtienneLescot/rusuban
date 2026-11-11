// The owner's settings (US9, T118, T119): one module for the owner's commands and the MCP. What widens
// agents' rights waits for the owner's card unless a person confirmed it in a terminal; what narrows
// applies at once; every change is journaled with its origin; nothing runs inside an agent run.
import "./tmp-root.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { homePath, loadConfig, read, saveConfig, write } from "../src/home.mjs";
import { flagsToPing, reloadConfig, startServer } from "../src/server.mjs";
import {
	changeSetting,
	confirmRequest,
	initInstance,
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
			{ id: "live", repos: [{ slug: "o/live" }] },
			{ id: "calm", repos: [{ slug: "o/calm" }] },
		],
	});
});
const as = { origin: "cli", by: "alice" };

test("what widens agents' rights, and what narrows them", () => {
	const widens = (change) => {
		const plan = planOf(loadConfig(), change);
		return plan.same ? "same" : plan.widens;
	};
	// A repo added, to a new project or an existing one, is acted on as its rules say.
	assert.equal(widens({ kind: "project.add", slug: "o/new" }), true);
	assert.equal(widens({ kind: "project.add", slug: "o/two", to: "live" }), true);
	assert.equal(widens({ kind: "project.bypass", project: "live", on: true }), true);
	assert.equal(widens({ kind: "project.bypass", project: "live", on: false }), "same");
	assert.equal(widens({ kind: "permissions.mode", mode: "bypass" }), true);
	// A project without a repo starts nothing by itself: each of its tasks waits for the owner.
	assert.equal(widens({ kind: "project.create", id: "posts" }), false);
	assert.throws(() => widens({ kind: "project.create", id: "live" }), /exists already/);
	assert.equal(widens({ kind: "project.remove", project: "calm" }), false);
	// The runs' model widens neither what agents may do nor where data goes; a flag is never one.
	assert.equal(widens({ kind: "model", model: "claude-opus-5-5" }), false);
	for (const bad of ["", "--dangerously-skip-permissions", "opus 5", undefined])
		assert.throws(() => widens({ kind: "model", model: bad }), /a model is a Claude Code model id/);
	// Where workers build widens nothing either: their folders there are Rusuban's to make and remove.
	assert.equal(widens({ kind: "workRoot", path: path.resolve("/rusuban-work") }), false);
	for (const bad of ["", "work", undefined])
		assert.throws(
			() => widens({ kind: "workRoot", path: bad }),
			/the work root is an absolute path/,
		);
	assert.throws(
		() => widens({ kind: "project.bypass", project: "nope", on: true }),
		/no project "nope"/,
	);
	assert.throws(() => widens({ kind: "owner.change" }), /unknown setting/);
});

test("the work root applies at once, and stays in config.json", () => {
	const root = path.resolve("/rusuban-work");
	assert.equal(changeSetting({ kind: "workRoot", path: root }, as).state, "applied");
	assert.equal(loadConfig().workRoot, root);
	assert.equal(changeSetting({ kind: "workRoot", path: root }, as).state, "unchanged");
});

test("narrowing applies at once; widening waits as a card; a terminal's typed confirmation applies it", () => {
	assert.equal(changeSetting({ kind: "limits", maxRunMinutes: 5 }, as).state, "applied");
	assert.equal(loadConfig().limits.maxRunMinutes, 5);

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
		{ kind: "project.bypass", project: "calm", on: true },
		{ ...as, origin: "terminal", confirmed: true },
	);
	assert.equal(typed.state, "applied");
	assert.equal(loadConfig().projects[1].bypassApproval, true);
	assert.deepEqual(
		settingsLog().map((e) => [e.setting, e.origin, e.state, !!e.notify]),
		[
			["limits", "cli", "applied", false],
			["permissions.mode", "mcp", "pending", false],
			["project.bypass", "terminal", "applied", true],
		],
	);
});

test("the owner allows or declines a setting's card; a card for what no longer exists says so", () => {
	const a = changeSetting({ kind: "project.bypass", project: "live", on: true }, as);
	const b = changeSetting({ kind: "project.bypass", project: "calm", on: true }, as);
	const c = changeSetting({ kind: "project.add", slug: "o/two", to: "live" }, as);
	assert.equal(confirmRequest(a.id, { allow: true, by: "alice" }).state, "confirmed");
	assert.equal(loadConfig().projects[0].bypassApproval, true);
	assert.equal(confirmRequest(b.id, { allow: false, by: "alice" }).state, "declined");
	assert.equal(loadConfig().projects[1].bypassApproval, false);
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
			["project.bypass", "pending"],
			["project.add", "pending"],
			["project.bypass", "confirmed"],
			["project.bypass", "declined"],
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

test("init writes the first config from the owner's answers, its limits spelled out, and only once", () => {
	const config = path.join(process.env.RUSUBAN_HOME, "config.json");
	fs.rmSync(config);
	const answers = {
		owner: "alice",
		mode: "bypass",
		armed: false,
		model: "claude-test",
		port: 8790,
		slug: "o/first",
	};
	// A wrong answer writes nothing, and the runs' model has no default.
	assert.throws(() => initInstance({ ...answers, slug: "first" }), /first is not owner\/repo/);
	assert.throws(() => initInstance({ ...answers, mode: "both" }), /permissions\.mode/);
	assert.throws(() => initInstance({ ...answers, model: undefined }), /has no default/);
	assert.ok(!fs.existsSync(config));
	const c = initInstance(answers);
	assert.deepEqual(
		[c.owner.login, c.port, c.permissions.mode, c.limits, c.model],
		["alice", 8790, "bypass", { maxWorkers: 3, maxRunMinutes: 150 }, "claude-test"],
	);
	assert.deepEqual(
		c.projects.map((p) => [p.id, p.repos[0].slug, Object.hasOwn(p, "mode")]),
		[["first", "o/first", false]],
	);
	assert.equal(read("automerge.json").armed, false);
	const [entry] = settingsLog();
	assert.deepEqual(
		[entry.setting, entry.origin, entry.project, entry.notify],
		["init", "terminal", "first", true],
	);
	assert.match(entry.text, /model claude-test/);
	assert.throws(() => initInstance(answers), /set up already/);
});

test("nothing is set inside an agent run", () => {
	process.env.RUSUBAN_RUN = "act-1";
	try {
		assert.throws(
			() => changeSetting({ kind: "limits", maxWorkers: 1 }, as),
			/never changed inside an agent run/,
		);
	} finally {
		delete process.env.RUSUBAN_RUN;
	}
	assert.throws(
		() => changeSetting({ kind: "limits", maxWorkers: 1 }, { origin: "agent", by: "x" }),
		/unknown origin/,
	);
});

test("the dashboard: the card in the inbox, allowed by the owner, never answered in words", async () => {
	const asked = changeSetting({ kind: "project.add", slug: "o/two", to: "calm" }, as);
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
		const repos = (c) => c.projects[1].repos.map((r) => r.slug);
		assert.deepEqual(repos(srv.ctx.config), ["o/calm", "o/two"], "the daemon applied it at once");
		assert.equal((await answer({ option: "allow" })).status, 404);
		assert.deepEqual((await call("GET", "/api/inbox")).body.cards, []);
		// The change shows in the project's journal, flagged for the owner.
		const { journal } = (await call("GET", "/api/state?project=calm")).body;
		assert.match(journal[0].text, /^Allowed by @alice: o\/two added to project calm/);
		assert.deepEqual(repos(read("config.json")), ["o/calm", "o/two"]);
	} finally {
		await srv.close();
	}
});

test("a machine widens where agents run: a card, then the registry; a desktop is the owner's only", () => {
	const mac = { name: "mac", os: "macos", ssh: "mac", caps: ["gpu"] };
	const asked = changeSetting({ kind: "machine.add", machine: mac }, as);
	assert.equal(asked.state, "pending");
	assert.equal(asked.text, "Let the agents work on mac (macOS, mac)?");
	assert.deepEqual(loadConfig().machines, []);
	assert.equal(confirmRequest(asked.id, { allow: true, by: "alice" }).state, "confirmed");
	assert.deepEqual(loadConfig().machines, [
		{ ...mac, workspace: "~/rusuban", agentUser: "rusuban", maxLeaseMin: 60 },
	]);
	assert.throws(
		() => changeSetting({ kind: "machine.add", machine: { ...mac, ssh: "mac-2" } }, as),
		/"mac" is used twice/,
	);
	assert.throws(
		() =>
			changeSetting(
				{
					kind: "machine.add",
					machine: { name: "desk", os: "windows", ssh: "desk", owner: "bob" },
				},
				as,
			),
		/bob has no dashboard/,
	);
	assert.throws(
		() => saveConfig({ ...loadConfig(), machines: [{ name: "Bad Name", os: "beos", ssh: "x" }] }),
		/machines\[0\]\.name must be lowercase[\s\S]*machines\[0\]\.os must be windows, macos, linux/,
	);
});

test("a config.json changed outside the settings module is flagged once, with what changed (T125)", async () => {
	const outside = () => settingsLog().filter((e) => e.origin === "outside");
	const byHand = (change) => {
		const raw = JSON.parse(fs.readFileSync(homePath("config.json"), "utf8"));
		change(raw);
		fs.writeFileSync(homePath("config.json"), JSON.stringify(raw));
	};
	const srv = await startServer({ port: 0, polling: false, quiet: true, tailnet: null });
	try {
		changeSetting({ kind: "limits", maxRunMinutes: 5 }, as);
		reloadConfig(srv.ctx);
		assert.deepEqual(outside(), [], "the settings module's own change");
		byHand((raw) => {
			raw.projects[0].title = "Live";
			raw.projects[0].bypassApproval = true;
			raw.channels = [
				{ id: "ntfy", type: "ntfy", target: "https://ntfy.example/secret-topic", urgency: ["now"] },
			];
		});
		reloadConfig(srv.ctx);
		reloadConfig(srv.ctx);
		assert.equal(outside().length, 1);
		const [flag] = outside();
		assert.equal(
			flag.text,
			`config.json was changed outside Rusuban's settings: projects.live.title: "live" → "Live"; projects.live.bypassApproval: false → true; channels.ntfy added.`,
		);
		assert.ok(!JSON.stringify(flag).includes("secret-topic"));
		assert.equal(flagsToPing([flag], "alice", "http://x")[0].card.urgency, "now");
		assert.equal(srv.ctx.config.projects[0].title, "Live", "the edit applies; it is only flagged");
	} finally {
		await srv.close();
	}
	byHand((raw) => {
		raw.limits.maxWorkers = 2;
	});
	for (let i = 0; i < 2; i++)
		await (await startServer({ port: 0, polling: false, quiet: true, tailnet: null })).close();
	assert.deepEqual(
		outside().map((e) => [e.text, e.notify]),
		[
			[outside()[0].text, true],
			["config.json was changed outside Rusuban's settings while the daemon was stopped.", true],
		],
	);
});
