// Rusuban's MCP server (T122, T123), spoken to on stdio as Claude Code does: each setting through the
// settings module, what widens waits for the owner, no tool answers a card, nothing inside a run.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, read, saveConfig } from "../src/home.mjs";
import { pendingRequests, settingsCards, settingsLog } from "../src/settings.mjs";

const BIN = fileURLToPath(new URL("../bin/rusuban.mjs", import.meta.url));

beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-mcp-"));
	saveConfig({
		version: 1,
		owner: { login: "alice" },
		port: 0,
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 2, maxRunMinutes: 60 },
		projects: [{ id: "demo", repos: [{ slug: "o/demo" }] }],
	});
});

// The server as Claude Code starts it, and a JSON-RPC call that waits for its own answer.
function server(env = {}) {
	const child = spawn(process.execPath, [BIN, "mcp"], { env: { ...process.env, ...env } });
	const waiting = new Map();
	readline.createInterface({ input: child.stdout }).on("line", (line) => {
		const msg = JSON.parse(line);
		waiting.get(msg.id)?.(msg);
	});
	let next = 0;
	return {
		child,
		call: (method, params) =>
			new Promise((resolve) => {
				const id = ++next;
				waiting.set(id, resolve);
				child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
			}),
		tool: async (name, args = {}) => {
			const { result } = await new Promise((resolve) => {
				const id = ++next;
				waiting.set(id, resolve);
				child.stdin.write(
					`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`,
				);
			});
			return result.isError
				? { error: result.content[0].text }
				: JSON.parse(result.content[0].text);
		},
		close: () => child.stdin.end(),
	};
}

test("it introduces itself and lists its tools, none of which answers a card", async () => {
	const s = server();
	try {
		const init = await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
		assert.deepEqual(
			[init.result.serverInfo.name, init.result.protocolVersion, !!init.result.capabilities.tools],
			["rusuban", "2025-06-18", true],
		);
		assert.match(init.result.instructions, /waits as a card the owner allows/);
		s.child.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
		);
		const { tools } = (await s.call("tools/list")).result;
		const names = tools.map((t) => t.name);
		assert.ok(
			names.includes("project_add") && names.includes("task_write") && names.includes("state"),
		);
		assert.ok(!names.some((n) => /answer|confirm|approve|allow/.test(n)), names.join(", "));
		assert.ok(tools.every((t) => t.inputSchema.type === "object" && t.description));
		assert.equal((await s.call("tools/call", { name: "answer_card" })).error.code, -32602);
		assert.equal((await s.call("nope")).error.code, -32601);
	} finally {
		s.close();
	}
});

test("what narrows applies, what widens waits for the owner; both journaled as the MCP's", async () => {
	const s = server();
	try {
		await s.call("initialize", {});
		const added = await s.tool("project_add", { slug: "o/new" });
		assert.deepEqual([added.state, added.text], ["pending", "Add o/new as project new?"]);
		assert.equal(loadConfig().projects.length, 1, "nothing changes before the owner allows it");
		assert.equal((await s.tool("merge_switch", { armed: true })).state, "pending");
		assert.equal((await s.tool("limits", { maxWorkers: 1 })).state, "applied");
		assert.equal((await s.tool("model", { model: "claude-opus-5-5" })).state, "applied");
		assert.equal((await s.tool("model", { model: "claude-opus-5-5" })).state, "unchanged");
		const posts = await s.tool("project_create", { id: "posts", title: "Posts" });
		assert.equal(posts.state, "applied", "a project without a repo starts nothing by itself");
		assert.deepEqual(loadConfig().projects.at(-1), {
			id: "posts",
			title: "Posts",
			bypassApproval: false,
			repos: [],
			folders: [],
			refreshSec: 90,
		});
		assert.equal((await s.tool("limits", { maxWorkers: 4 })).state, "pending");
		assert.equal(
			(await s.tool("project_bypass", { project: "demo", on: false })).state,
			"unchanged",
		);
		assert.match(
			(await s.tool("project_bypass", { project: "gone", on: false })).error,
			/no project "gone"/,
		);
		const state = await s.tool("state");
		assert.deepEqual(
			state.waitingForTheOwner.map((w) => [w.origin, w.question]),
			[
				["mcp", "Add o/new as project new?"],
				["mcp", "Arm automatic merges?"],
				["mcp", "Raise the limits to 4 workers and 60 minutes a run?"],
			],
		);
		assert.deepEqual(state.limits, { maxWorkers: 1, maxRunMinutes: 60 });
		assert.equal(state.model, "claude-opus-5-5");
		assert.ok(settingsLog().every((e) => e.origin === "mcp"));
		// The owner reads on the card that Claude asked, and that Claude is told if it is declined.
		const [card] = settingsCards(loadConfig());
		assert.match(card.card.ctx, /^Asked from Claude, through the MCP/);
		assert.match(card.card.options[1].effect, /Claude is told\.$/);
	} finally {
		s.close();
	}
});

test("a task written from Claude waits, its card showing the task, then the diff of its file", async () => {
	const s = server();
	try {
		await s.call("initialize", {});
		const asked = await s.tool("task_write", {
			id: "digest",
			title: "Weekly digest",
			project: "demo",
			schedule: "daily 09:00",
			prompt: "Write the digest.",
		});
		assert.equal(asked.state, "pending");
		assert.ok(!fs.existsSync(path.join(process.env.RUSUBAN_HOME, "tasks/digest.md")));
		let [card] = settingsCards(loadConfig());
		assert.equal(card.card.q, "Add the task “Weekly digest” to demo?");
		assert.match(
			card.card.ctx,
			/It runs daily 09:00, as a Claude session of demo\. Its prompt:\n\nWrite the digest\./,
		);
		// Written by hand meanwhile: a second ask shows the diff.
		fs.mkdirSync(path.join(process.env.RUSUBAN_HOME, "tasks"), { recursive: true });
		fs.writeFileSync(
			path.join(process.env.RUSUBAN_HOME, "tasks/digest.md"),
			"---\ntitle: Weekly digest\nproject: demo\nschedule: daily 09:00\n---\nWrite the digest.\n",
		);
		await s.tool("task_write", {
			id: "digest",
			title: "Weekly digest",
			project: "demo",
			schedule: "daily 18:00",
			prompt: "Write the digest.",
		});
		[, card] = settingsCards(loadConfig());
		assert.match(
			card.card.ctx,
			/^Asked from Claude.*Its file changes:\n\n- schedule: daily 09:00\n\+ schedule: daily 18:00/s,
		);
		assert.match(
			(await s.tool("task_write", { id: "x", title: "X", project: "nope", prompt: "Go." })).error,
			/project "nope" is none of this instance/,
		);
		assert.equal((await s.tool("task_remove", { id: "digest" })).state, "applied");
		assert.ok(fs.existsSync(path.join(process.env.RUSUBAN_HOME, "tasks/digest.md.removed")));
	} finally {
		s.close();
	}
});

test("inside a Rusuban run, the server never starts", () => {
	const r = spawnSync(process.execPath, [BIN, "mcp"], {
		encoding: "utf8",
		input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "host_profile", arguments: { mode: "bypass" } } })}\n`,
		env: { ...process.env, RUSUBAN_RUN: "act-1", RUSUBAN_PROJECT: "demo" },
	});
	assert.equal(r.status, 1);
	assert.match(r.stderr, /"mcp" is the owner's command, never run inside an agent run/);
	assert.equal(r.stdout, "");
	assert.deepEqual(pendingRequests(), []);
	assert.equal(read("config.json").permissions.mode, "allowlist");
});
