import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { read, saveConfig } from "../src/home.mjs";
import { checkPost, checkRequest, startServer } from "../src/server.mjs";

const OWNER = { login: "alice" };
const at = (headers) =>
	checkRequest({ host: "127.0.0.1:8788", ...headers }, { port: 8788, owner: OWNER });
const write = (headers) =>
	checkPost(
		{ origin: "http://127.0.0.1:8788", "x-rusuban": "1", "content-length": "20", ...headers },
		{ port: 8788 },
	);

test("a request must name this server as its host", () => {
	assert.equal(at({}), null);
	assert.equal(at({ host: "localhost:8788" }), null);
	assert.equal(at({ host: "evil.example:8788" }).status, 403);
	assert.equal(at({ host: "127.0.0.1:9999" }).status, 403);
});

test("a tailnet caller must be the owner", () => {
	assert.equal(at({ host: "box.tail1234.ts.net", "tailscale-user-login": "alice@github" }), null);
	assert.equal(at({ host: "box.tail1234.ts.net", "tailscale-user-login": "Alice" }), null);
	assert.equal(
		at({ host: "box.tail1234.ts.net", "tailscale-user-login": "mallory@github" }).error,
		"not the owner",
	);
	assert.equal(at({ "tailscale-user-login": "mallory@github" }).status, 403);
	assert.equal(at({ host: "box.tail1234.ts.net" }).error, "no tailnet identity");
	assert.equal(
		checkRequest(
			{ host: "box.ts.net", "tailscale-user-login": "a@b.c" },
			{ port: 1, owner: { login: "alice", tailscale: "a@b.c" } },
		),
		null,
	);
});

test("a write needs our origin, the x-rusuban header and a small body", () => {
	assert.equal(write({}), null);
	assert.equal(write({ origin: "https://box.tail1234.ts.net" }), null);
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
		owner: OWNER,
		permissions: { mode: "allowlist" },
		projects: [{ id: "demo", repos: [{ slug: "o/r" }] }],
	});
	srv = await startServer({ port: 0, polling: false, quiet: true });
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
		[state.me, state.armed, state.project.id, state.project.observeOnly],
		["alice", false, "demo", true],
	);
	const events = await call("GET", "/api/events?project=demo");
	assert.match(events.text, /^event: state\ndata: \{/);
});

test("the merge switch takes a proper write and journals it", async () => {
	const ok = await call("POST", "/api/automerge", {
		headers: ours(),
		body: JSON.stringify({ armed: true }),
	});
	assert.deepEqual([ok.status, JSON.parse(ok.text)], [200, { armed: true }]);
	assert.equal(read("automerge.json").armed, true);
	assert.match(
		fs.readFileSync(path.join(process.env.RUSUBAN_HOME, "projects/demo/journal.jsonl"), "utf8"),
		/Merges armed/,
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
