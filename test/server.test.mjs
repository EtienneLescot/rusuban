import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { agentLog, read, readJsonl, saveConfig } from "../src/home.mjs";
import { checkPost, checkRequest, startServer } from "../src/server.mjs";

const OWNER = { login: "alice", tailscaleLogin: "alice@example.com" };
const TAILNET = "box.tail1234.ts.net";
const at = (headers, owner = OWNER, tailnet = TAILNET) =>
	checkRequest({ host: "127.0.0.1:8788", ...headers }, { port: 8788, owner, tailnet });
const remote = (login, host = TAILNET) => at({ host, "tailscale-user-login": login });
const write = (headers) =>
	checkPost(
		{ origin: "http://127.0.0.1:8788", "x-rusuban": "1", "content-length": "20", ...headers },
		{ port: 8788, tailnet: TAILNET },
	);

test("a request must name this server as its host: loopback or its own tailnet name", () => {
	assert.equal(at({}), null);
	assert.equal(at({ host: "localhost:8788" }), null);
	assert.equal(at({ host: "evil.example:8788" }).status, 403);
	assert.equal(at({ host: "127.0.0.1:9999" }).status, 403);
	assert.equal(remote("alice@example.com", "other.tail9999.ts.net").error, "unknown host");
	assert.equal(
		at({ host: TAILNET, "tailscale-user-login": "alice@example.com" }, OWNER, null).error,
		"unknown host",
	);
});

test("on the tailnet name, the caller must be the owner's Tailscale login", () => {
	assert.equal(remote("alice@example.com"), null);
	assert.equal(remote("Alice@Example.com"), null);
	assert.equal(remote("alice@example.com", `${TAILNET}:8443`), null);
	// The GitHub login is not the Tailscale login.
	assert.equal(remote("alice").error, "not the owner");
	assert.equal(remote("alice@github").error, "not the owner");
	assert.equal(remote("mallory@example.com").error, "not the owner");
	assert.equal(at({ host: TAILNET }).error, "no tailnet identity");
	assert.equal(at({ "tailscale-user-login": "mallory@example.com" }).status, 403);
	// Without a stored Tailscale login, nobody comes in from the tailnet.
	assert.equal(
		at({ host: TAILNET, "tailscale-user-login": "alice@example.com" }, { login: "alice" }).error,
		"not the owner",
	);
});

test("a write needs our origin, the x-rusuban header and a small body", () => {
	assert.equal(write({}), null);
	assert.equal(write({ origin: `https://${TAILNET}` }), null);
	assert.equal(write({ origin: "https://other.tail9999.ts.net" }).error, "origin refused");
	assert.equal(write({ origin: "https://evil.example" }).error, "origin refused");
	assert.equal(write({ origin: undefined }).error, "origin refused");
	assert.equal(write({ "x-rusuban": undefined }).error, "missing x-rusuban header");
	assert.equal(write({ "content-length": "9000" }).status, 413);
});

// ── The real server, on a free port, without reading GitHub ───────────────────────────────────
let srv;
before(async () => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-server-"));
	saveConfig({
		version: 1,
		owner: OWNER,
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 3, maxRunMinutes: 150 },
		projects: [{ id: "demo", mode: "shadow", repos: [{ slug: "o/r" }] }],
	});
	srv = await startServer({ port: 0, polling: false, quiet: true, tailnet: TAILNET });
});
after(() => srv.close());

function call(method, urlPath, { headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: "127.0.0.1", port: srv.port, method, path: urlPath, headers },
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (c) => {
					text += c;
					if (res.headers["content-type"] === "text/event-stream") res.destroy();
				});
				res.on("close", () => resolve({ status: res.statusCode, text }));
			},
		);
		req.on("error", reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}
const ours = () => ({
	origin: `http://127.0.0.1:${srv.port}`,
	"x-rusuban": "1",
	"content-type": "application/json",
});

test("the state and its live stream are served on loopback, merges paused until armed", async () => {
	const res = await call("GET", "/api/state?project=demo");
	assert.equal(res.status, 200);
	const state = JSON.parse(res.text);
	assert.deepEqual(
		[state.me, state.armed, state.project.id, state.project.mode, state.project.observeOnly],
		["alice", false, "demo", "shadow", true],
	);
	const events = await call("GET", "/api/events?project=demo");
	assert.match(events.text, /^event: state\ndata: \{/);
});

test("reads from the tailnet need its name as Host and the owner's Tailscale login", async () => {
	const get = (host, login) =>
		call("GET", "/api/state?project=demo", { headers: { host, "tailscale-user-login": login } });
	assert.equal((await get(TAILNET, "alice@example.com")).status, 200);
	assert.equal((await get(TAILNET, "alice")).status, 403);
	assert.equal((await get("other.tail9999.ts.net", "alice@example.com")).status, 403);
});

test("the merge switch takes a proper write and journals it; the agents' log shows in the same journal", async () => {
	const ok = await call("POST", "/api/automerge", {
		headers: ours(),
		body: JSON.stringify({ armed: true }),
	});
	assert.deepEqual([ok.status, JSON.parse(ok.text)], [200, { armed: true }]);
	const saved = read("automerge.json");
	assert.deepEqual([saved.armed, saved.by, Date.parse(saved.at) > 0], [true, "alice", true]);
	// The settings module writes the switch and journals it, with the dashboard as its origin.
	const [entry] = readJsonl("settings.jsonl");
	assert.deepEqual(
		[entry.setting, entry.origin, entry.state, entry.text],
		["switch", "dashboard", "applied", "Merges armed"],
	);
	// A later write than the switch: two entries of the same millisecond have no order of their own.
	await new Promise((resolve) => setTimeout(resolve, 5));
	agentLog("demo", { kind: "note", item: null, text: "Judged 3 PRs", by: "agent:judge-1" });
	const { journal } = JSON.parse((await call("GET", "/api/state?project=demo")).text);
	assert.deepEqual(
		journal.map((e) => e.text),
		["Judged 3 PRs", "Merges armed"],
	);
});

test("forged writes are refused: no header, foreign origin, foreign host, a stranger, a big body", async () => {
	const body = JSON.stringify({ armed: false });
	assert.equal(
		(await call("POST", "/api/automerge", { headers: { ...ours(), "x-rusuban": "" }, body }))
			.status,
		403,
	);
	assert.equal(
		(
			await call("POST", "/api/automerge", {
				headers: { ...ours(), origin: "https://evil.example" },
				body,
			})
		).status,
		403,
	);
	assert.equal(
		(await call("GET", "/api/state", { headers: { host: "rebound.example" } })).status,
		403,
	);
	assert.equal(
		(await call("GET", "/api/state", { headers: { "tailscale-user-login": "mallory@github" } }))
			.status,
		403,
	);
	const big = await call("POST", "/api/automerge", {
		headers: { ...ours(), "transfer-encoding": "chunked" },
		body: `{"pad":"${"x".repeat(9000)}"}`,
	});
	assert.equal(big.status, 413);
	assert.equal(read("automerge.json").armed, true);
});

test("conversations: the list with the index's age, an unknown one is 404, a terminal opens only here", async () => {
	const list = JSON.parse((await call("GET", "/api/conversations?project=demo")).text);
	assert.deepEqual(list, { indexedAt: null, items: {}, conversations: [], error: null });
	assert.equal((await call("GET", "/api/conversations/nope")).status, 404);
	const terminal = (headers) =>
		call("POST", "/api/conversations/nope/terminal", { headers, body: "{}" });
	const fromTailnet = await terminal({
		...ours(),
		host: TAILNET,
		origin: `https://${TAILNET}`,
		"tailscale-user-login": "alice@example.com",
	});
	assert.deepEqual(
		[fromTailnet.status, JSON.parse(fromTailnet.text).error],
		[403, "a terminal opens only from this machine"],
	);
	assert.equal((await terminal(ours())).status, 404);
});
