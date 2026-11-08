// Rusuban's MCP server (US9, contracts/mcp.md): every setting from Claude, through the same settings
// module as the owner's commands, and the state to read. It speaks JSON-RPC on stdio, one message a
// line. It never runs inside a Rusuban run (FR-095), and none of its tools answers a card (FR-091).
import fs from "node:fs";
import readline from "node:readline";
import { loadConfig, read, readJournal } from "./home.mjs";
import { runsOf, stateOf } from "./server.mjs";
import { changeSetting, maskTarget, pendingRequests } from "./settings.mjs";
import { tasksState } from "./tasks.mjs";

const { version } = JSON.parse(
	fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const INSTRUCTIONS =
	"Rusuban minds the owner's projects. These tools read its state and change its settings. A change that widens what agents may do (a project live, the approval bypass, armed merges, the bypass host profile, a task, a new owner, higher limits) does not apply here: it waits as a card the owner allows in Rusuban's dashboard. Say so to the owner when a tool answers `pending`.";

const text = { type: "string" };
const obj = (properties = {}, required = []) => ({ type: "object", properties, required });
// A setting through the module, from the MCP: what widens comes back `pending`, with its card's id.
const set = (change) => {
	const config = loadConfig();
	return changeSetting(change, { origin: "mcp", by: config.owner.login });
};
const frontMatter = ({ title, project, schedule, lock, cwd, prompt }) =>
	`---\n${Object.entries({ title, project, schedule, lock, cwd })
		.filter(([, v]) => v)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n")}\n---\n${String(prompt ?? "").trim()}\n`;
const view = (config) => ({ config, dry: false, errors: new Map(), loops: new Map() });

export const TOOLS = [
	{
		name: "state",
		description:
			"The instance: owner, host profile, limits, the merge switch, the projects with their mode, bypass and repos, and the settings waiting for the owner's confirmation.",
		inputSchema: obj(),
		run: () => {
			const c = loadConfig();
			return {
				owner: c.owner.login,
				hostProfile: c.permissions.mode,
				remoteAccess: !!c.owner.tailscaleLogin,
				limits: c.limits,
				mergesArmed: read("automerge.json", { armed: false }).armed === true,
				channels: c.channels.map((ch) => ({
					id: ch.id,
					type: ch.type,
					target: maskTarget(ch),
					urgency: ch.urgency,
				})),
				projects: c.projects.map(({ id, title, mode, bypassApproval, repos }) => ({
					id,
					title,
					mode,
					bypassApproval,
					repos: repos.map((r) => r.slug),
				})),
				waitingForTheOwner: pendingRequests().map((r) => ({
					id: r.id,
					at: r.at,
					origin: r.origin,
					project: r.project,
					question: r.card.q,
				})),
			};
		},
	},
	{
		name: "project_state",
		description:
			"One project: its open items with their judgment (kind, owner, next step, what blocks), its open cards, its rules and the age of its GitHub read.",
		inputSchema: obj({ project: text }, ["project"]),
		run: ({ project }) => {
			const s = stateOf(view(loadConfig()), project);
			if (s.project?.id !== project) throw new Error(`no project "${project}"`);
			return {
				project: s.project,
				freshness: s.freshness,
				rules: s.rules,
				items: s.model.nodes.map((n) => ({
					item: n.id,
					type: n.type,
					label: n.label,
					kind: n.kind ?? null,
					owner: n.owner ?? null,
					next: n.next ?? null,
					block: n.block ?? null,
					card: n.decision?.q ?? null,
				})),
			};
		},
	},
	{
		name: "runs",
		description: "Runs at work first, then recent ones, with their summary and conversation.",
		inputSchema: obj({ project: text }),
		run: ({ project }) => runsOf(project ?? null).slice(0, 30),
	},
	{
		name: "tasks",
		description: "The recurring tasks: schedule, next slot, state and last runs.",
		inputSchema: obj(),
		run: () => tasksState(loadConfig()),
	},
	{
		name: "journal",
		description: "A project's journal, settings changes included, newest first.",
		inputSchema: obj({ project: text, limit: { type: "integer" } }, ["project"]),
		run: ({ project, limit = 40 }) => readJournal(project).slice(-limit).reverse(),
	},
	{
		name: "project_add",
		description:
			"Adds a repo (owner/repo): to a new project, in shadow mode, or to an existing one with `to`. To a live project it waits for the owner.",
		inputSchema: obj({ slug: text, checkout: text, to: text }, ["slug"]),
		run: ({ slug, checkout, to }) =>
			set({ kind: "project.add", slug, checkout: checkout ?? null, to: to ?? null }),
	},
	{
		name: "project_remove",
		description:
			"Removes a project from the instance; its files stay. Refused while one of its runs waits or works.",
		inputSchema: obj({ project: text }, ["project"]),
		run: ({ project }) => set({ kind: "project.remove", project }),
	},
	{
		name: "project_mode",
		description: "`shadow` applies at once; `live` waits for the owner.",
		inputSchema: obj({ project: text, mode: { type: "string", enum: ["live", "shadow"] } }, [
			"project",
			"mode",
		]),
		run: ({ project, mode }) => set({ kind: "project.mode", project, mode }),
	},
	{
		name: "project_bypass",
		description: "The approval bypass of a project: off applies at once; on waits for the owner.",
		inputSchema: obj({ project: text, on: { type: "boolean" } }, ["project", "on"]),
		run: ({ project, on }) => set({ kind: "project.bypass", project, on }),
	},
	{
		name: "host_profile",
		description:
			"What agents may run on this machine: `allowlist` applies at once; `bypass` waits for the owner.",
		inputSchema: obj({ mode: { type: "string", enum: ["bypass", "allowlist"] } }, ["mode"]),
		run: ({ mode }) => set({ kind: "permissions.mode", mode }),
	},
	{
		name: "merge_switch",
		description: "Pausing merges applies at once; arming them waits for the owner.",
		inputSchema: obj({ armed: { type: "boolean" } }, ["armed"]),
		run: ({ armed }) => set({ kind: "switch", armed }),
	},
	{
		name: "limits",
		description:
			"The most workers at once and the longest run; raising either waits for the owner.",
		inputSchema: obj({ maxWorkers: { type: "integer" }, maxRunMinutes: { type: "integer" } }),
		run: ({ maxWorkers, maxRunMinutes }) => set({ kind: "limits", maxWorkers, maxRunMinutes }),
	},
	{
		name: "owner",
		description: "Makes another GitHub login the owner; it waits for the current owner.",
		inputSchema: obj({ login: text }, ["login"]),
		run: ({ login }) => set({ kind: "owner", login }),
	},
	{
		name: "task_write",
		description:
			"Writes a recurring task (`daily HH:MM,…`, or none to run it on a click). It waits for the owner, whose card shows the task or the diff of its file.",
		inputSchema: obj(
			{ id: text, title: text, project: text, schedule: text, lock: text, cwd: text, prompt: text },
			["id", "title", "project", "prompt"],
		),
		run: (a) => set({ kind: "task.write", id: a.id, text: frontMatter(a) }),
	},
	{
		name: "channel_add",
		description:
			"Adds a channel cards ping (ntfy, slack, discord, teams or email, its target a URL or an address). It sends data out, so it waits for the owner.",
		inputSchema: obj(
			{
				type: { type: "string", enum: ["ntfy", "slack", "discord", "teams", "email"] },
				target: text,
				urgency: { type: "array", items: { type: "string", enum: ["now", "digest"] } },
				quietHours: text,
				digestAt: text,
				smtp: text,
				from: text,
				token: text,
			},
			["type", "target"],
		),
		run: (a) => set({ kind: "channel.add", ...a }),
	},
	{
		name: "channel_remove",
		description: "Removes a channel: it applies at once.",
		inputSchema: obj({ id: text }, ["id"]),
		run: ({ id }) => set({ kind: "channel.remove", id }),
	},
	{
		name: "remote",
		description:
			"The dashboard on this machine's tailnet name, through Tailscale Serve, for the owner's devices: turning it on waits for the owner; off applies at once.",
		inputSchema: obj({ enabled: { type: "boolean" } }, ["enabled"]),
		run: ({ enabled }) => set({ kind: "remote", on: enabled }),
	},
	{
		name: "task_remove",
		description: "Sets a task aside: it no longer runs, and its file is kept.",
		inputSchema: obj({ id: text }, ["id"]),
		run: ({ id }) => set({ kind: "task.remove", id }),
	},
];

const rpcError = (code, message) => Object.assign(new Error(message), { code });

function handle({ method, params = {} }) {
	if (method === "initialize")
		return {
			protocolVersion: params.protocolVersion ?? "2025-06-18",
			capabilities: { tools: {} },
			serverInfo: { name: "rusuban", version },
			instructions: INSTRUCTIONS,
		};
	if (method === "ping") return {};
	if (method === "tools/list") return { tools: TOOLS.map(({ run, ...t }) => t) };
	if (method === "tools/call") {
		const tool = TOOLS.find((t) => t.name === params.name);
		if (!tool) throw rpcError(-32602, `unknown tool "${params.name}"`);
		// A refused change is the tool's answer, not a protocol error.
		try {
			const result = tool.run(params.arguments ?? {});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] };
		} catch (e) {
			return { content: [{ type: "text", text: e.message }], isError: true };
		}
	}
	throw rpcError(-32601, `no method "${method}"`);
}

// Started by Claude Code as `rusuban mcp`. The command itself refuses inside a run (FR-095).
export async function serveMcp({ input = process.stdin, output = process.stdout } = {}) {
	const send = (message) => output.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
	for await (const line of readline.createInterface({ input })) {
		if (!line.trim()) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			send({ id: null, error: { code: -32700, message: "not JSON" } });
			continue;
		}
		if (msg.id === undefined || msg.id === null) continue; // a notification, never answered
		try {
			send({ id: msg.id, result: handle(msg) });
		} catch (e) {
			send({ id: msg.id, error: { code: e.code ?? -32603, message: e.message } });
		}
	}
}
