// The daemon. It reads every project's repos and rules on their own clock, computes the model, and
// serves the dashboard with its live stream, on 127.0.0.1 only. Remote access goes through Tailscale
// Serve, whose identity header must be the owner's Tailscale login (research R7). It reads GitHub and
// never writes to it here; `dry` marks a run that must never write to GitHub nor start an agent, the
// promise the merge gate and the judge trigger will keep once they exist.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { kickQueues, listRuns } from "./agents.mjs";
import { poll } from "./github.mjs";
import { homePath, journal, loadConfig, read, readJournal, readJsonl, write } from "./home.mjs";
import { buildModel, flatten, keyOf } from "./model.mjs";
import { loadRules } from "./rules.mjs";

const WEB = new URL("../web/", import.meta.url);
const STATIC = {
	"/": ["index.html", "text/html; charset=utf-8"],
	"/app.js": ["app.js", "text/javascript; charset=utf-8"],
	"/app.css": ["app.css", "text/css; charset=utf-8"],
};
const MAX_BODY = 8192;
const { version } = JSON.parse(
	fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const hash = (v) => crypto.createHash("sha1").update(v).digest("hex");
const firstLine = (e) =>
	String(e?.stderr || e?.message || e)
		.trim()
		.split("\n")[0];

// ── Who may ask ───────────────────────────────────────────────────────────────────────────────
const localHosts = (port) => [`127.0.0.1:${port}`, `localhost:${port}`];
const onName = (host, name) => !!name && (host === name || host.startsWith(`${name}:`));

// The machine's tailnet name, the Host that Tailscale Serve forwards; null when Tailscale is not
// installed or not logged in.
export function tailnetName() {
	return new Promise((resolve) =>
		execFile("tailscale", ["status", "--json"], { timeout: 5000, windowsHide: true }, (e, out) => {
			try {
				const name = e ? null : JSON.parse(out).Self?.DNSName;
				resolve(name ? name.replace(/\.$/, "").toLowerCase() : null);
			} catch {
				resolve(null);
			}
		}),
	);
}

// Every request, GET included (transcripts are private): the Host must be this server's, on loopback
// or on its tailnet name, so a page cannot reach it by DNS rebinding. On the tailnet name, Tailscale
// Serve's identity header must be the owner's Tailscale login (research R7). A loopback request
// without that header is the local user.
export function checkRequest(headers, { port, owner, tailnet = null }) {
	const host = String(headers.host ?? "").toLowerCase();
	const remote = onName(host, tailnet);
	if (!remote && !localHosts(port).includes(host)) return { status: 403, error: "unknown host" };
	const login = headers["tailscale-user-login"];
	if (login === undefined) return remote ? { status: 403, error: "no tailnet identity" } : null;
	const mine = owner.tailscaleLogin?.toLowerCase();
	return mine && String(login).toLowerCase() === mine
		? null
		: { status: 403, error: "not the owner" };
}

// Every write also needs the dashboard's own origin, the x-rusuban header (another site cannot send
// it without a CORS preflight this server never answers) and a body under 8 KB.
export function checkPost(headers, { port, tailnet = null }) {
	const origin = String(headers.origin ?? "").toLowerCase();
	const ours =
		localHosts(port).some((h) => origin === `http://${h}`) ||
		(origin.startsWith("https://") && onName(origin.slice(8), tailnet));
	if (!ours) return { status: 403, error: "origin refused" };
	if (headers["x-rusuban"] !== "1") return { status: 403, error: "missing x-rusuban header" };
	if (Number(headers["content-length"] ?? 0) > MAX_BODY)
		return { status: 413, error: "body over 8 KB" };
	return null;
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		// Past the limit the rest is read and dropped, so the client still gets its 413.
		req.on("data", (c) => {
			size += c.length;
			if (size > MAX_BODY) reject(Object.assign(new Error("body over 8 KB"), { status: 413 }));
			else chunks.push(c);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch {
				reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
			}
		});
		req.on("error", reject);
	});
}

// ── What the page shows ───────────────────────────────────────────────────────────────────────
// What a running run works on right now: the open items its log lines of the last two minutes
// cite (`gh pr view 1374`, `rusuban show #1374`, its sentences), six at most, latest first.
function focusOf(run, live) {
	if (run.state !== "running" || !run.log) return [];
	const byN = new Map();
	for (const i of [...live.prs, ...live.issues]) byN.set(i.n, [...(byN.get(i.n) ?? []), keyOf(i)]);
	let text;
	try {
		text = fs.readFileSync(homePath(`runs/${run.id}/${run.log}`), "utf8").slice(-8000);
	} catch {
		return [];
	}
	const now = new Date();
	const found = [];
	for (const l of text.trim().split("\n").reverse()) {
		const m = /^(\d\d):(\d\d):(\d\d)\s+(.*)$/.exec(l);
		if (!m) continue;
		const at = new Date(now);
		at.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0);
		if (now - at > 120_000) break;
		for (const x of m[4].matchAll(/#?\b(\d{2,6})\b/g))
			for (const k of byN.get(Number(x[1])) ?? []) if (!found.includes(k)) found.push(k);
		if (found.length >= 6) break;
	}
	return found.slice(0, 6);
}

export const isArmed = () => read("automerge.json", { armed: false }).armed === true;

export function stateOf(ctx, projectId) {
	const { config } = ctx;
	const me = config.owner.login;
	const armed = isArmed();
	const p = config.projects.find((x) => x.id === projectId) ?? config.projects[0] ?? null;
	const base = {
		version,
		dry: ctx.dry,
		me,
		armed,
		projects: config.projects.map(({ id, title }) => ({ id, title })),
	};
	const empty = { prs: [], issues: [], merged: [] };
	if (!p)
		return {
			...base,
			project: null,
			model: buildModel({ live: empty, judgment: { items: {} }, armed, me }),
			freshness: null,
			rules: {},
			runs: [],
			journal: [],
		};
	const dir = `projects/${p.id}`;
	const liveFile = read(`${dir}/live.json`, { repos: {} });
	const live = flatten(liveFile);
	const rules = read(`${dir}/rules.json`, {});
	const journalAll = readJournal(p.id);
	const runs = listRuns(p.id)
		.slice(0, 30)
		.map((r) => ({ ...r, focus: focusOf(r, live) }));
	const repos = p.repos.map((r) => r.slug);
	const checked = repos.map((s) => liveFile.repos?.[s]?.checkedAt);
	const errors = [
		ctx.errors.get(p.id),
		...repos.map((s) => liveFile.repos?.[s]?.error ?? rules[s]?.error),
	].filter(Boolean);
	return {
		...base,
		project: {
			id: p.id,
			title: p.title,
			mode: p.mode,
			repos,
			observeOnly: repos.every((s) => rules[s]?.observeOnly !== false),
		},
		model: buildModel({
			live,
			judgment: read(`${dir}/judgment.json`, { items: {} }),
			rules,
			answers: readJsonl(`${dir}/answers.jsonl`),
			journal: journalAll,
			runs,
			armed,
			shadow: p.mode === "shadow",
			me,
		}),
		freshness: {
			checkedAt: checked.every(Boolean) ? checked.sort()[0] : null,
			refreshing: ctx.loops.get(p.id)?.isRunning() ?? false,
			intervalMs: p.refreshSec * 1000,
			error: errors[0] ?? null,
			repos: Object.fromEntries(
				repos.map((s) => [
					s,
					{
						checkedAt: liveFile.repos?.[s]?.checkedAt ?? null,
						changedAt: liveFile.repos?.[s]?.changedAt ?? null,
						error: liveFile.repos?.[s]?.error ?? null,
					},
				]),
			),
			rate: liveFile.rate ?? null,
		},
		rules: Object.fromEntries(
			repos.map((s) => {
				const r = rules[s];
				return [
					s,
					r
						? {
								observeOnly: r.observeOnly,
								ref: r.ref ?? null,
								treeSha: r.treeSha,
								files: (r.files ?? []).map((f) => f.name),
								locks: r.locks,
								errors: r.errors ?? [],
								checkedAt: r.checkedAt ?? null,
								error: r.error ?? null,
							}
						: null,
				];
			}),
		),
		runs: runs.map(
			({
				id,
				kind,
				title,
				items,
				state,
				step,
				startedAt,
				endedAt,
				summary,
				session,
				createdAt,
			}) => ({
				id,
				kind,
				title,
				items,
				state,
				step,
				startedAt,
				endedAt,
				summary,
				session,
				createdAt,
			}),
		),
		journal: journalAll.slice(-40).reverse(),
	};
}

// ── The daemon ────────────────────────────────────────────────────────────────────────────────
function startLoop(ctx, p) {
	const dir = `projects/${p.id}`;
	const loop = poll(
		p,
		async (live, error) => {
			if (error) {
				ctx.errors.set(p.id, firstLine(error));
				ctx.say(`${p.id}: read failed: ${firstLine(error)}`);
				return;
			}
			write(`${dir}/live.json`, live);
			// The rules follow the same clock, each from its repo's default branch. A failed read keeps
			// the last rules read from that branch.
			const rules = read(`${dir}/rules.json`, {});
			for (const { slug } of p.repos) {
				const branch = live.repos[slug]?.defaultBranch;
				if (!branch) continue;
				try {
					rules[slug] = await loadRules(slug, branch, rules[slug]);
				} catch (e) {
					rules[slug] = {
						observeOnly: true,
						files: [],
						locks: null,
						errors: [],
						...rules[slug],
						error: firstLine(e),
						errorAt: new Date().toISOString(),
					};
				}
			}
			write(`${dir}/rules.json`, rules);
			ctx.errors.delete(p.id);
			kickQueues();
			const items = Object.values(live.repos).reduce(
				(s, r) => s + (r.prs?.length ?? 0) + (r.issues?.length ?? 0),
				0,
			);
			ctx.say(`${p.id}: ${items} open items read`);
			ctx.broadcast(true);
		},
		{ initial: read(`${dir}/live.json`, null) },
	);
	ctx.loops.set(p.id, loop);
}

function send(res, status, type, body) {
	res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
	res.end(body);
}
const json = (res, status, v) =>
	send(res, status, "application/json; charset=utf-8", JSON.stringify(v));

async function post(ctx, path, body, res) {
	const by = ctx.config.owner.login;
	if (path === "/api/automerge") {
		if (typeof body.armed !== "boolean")
			return json(res, 400, { error: "armed must be true or false" });
		write("automerge.json", { armed: body.armed, at: new Date().toISOString(), by });
		for (const p of ctx.config.projects)
			journal(p.id, {
				kind: "switch",
				item: null,
				text: body.armed ? "Merges armed" : "Merges paused",
				by,
			});
		ctx.broadcast(true);
		return json(res, 200, { armed: isArmed() });
	}
	if (path === "/api/refresh") {
		const loops = body.project
			? [ctx.loops.get(body.project)].filter(Boolean)
			: [...ctx.loops.values()];
		for (const l of loops) l.refresh();
		return json(res, 202, { ok: true });
	}
	return json(res, 404, { error: "unknown" });
}

async function handle(ctx, req, res) {
	const url = new URL(req.url ?? "/", "http://local");
	const refused = checkRequest(req.headers, ctx);
	if (refused) return json(res, refused.status, { error: refused.error });
	try {
		if (req.method === "GET" && STATIC[url.pathname]) {
			const [file, type] = STATIC[url.pathname];
			return send(res, 200, type, fs.readFileSync(new URL(file, WEB)));
		}
		if (req.method === "GET" && url.pathname === "/api/state")
			return json(res, 200, stateOf(ctx, url.searchParams.get("project")));
		if (req.method === "GET" && url.pathname === "/api/events") {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				connection: "keep-alive",
			});
			const client = { res, project: url.searchParams.get("project"), sent: "" };
			ctx.clients.add(client);
			ctx.push(client, true);
			req.on("close", () => ctx.clients.delete(client));
			return;
		}
		if (req.method === "POST") {
			const no = checkPost(req.headers, ctx);
			if (no) return json(res, no.status, { error: no.error });
			return await post(ctx, url.pathname, await readBody(req), res);
		}
		send(res, 404, "text/plain; charset=utf-8", "404");
	} catch (e) {
		if (!res.headersSent) json(res, e.status ?? 500, { error: firstLine(e) });
	}
}

// Starts the daemon. `polling: false` serves without reading GitHub (tests); `port` overrides the
// config's (0 picks a free one); `tailnet` sets the tailnet name instead of asking Tailscale.
export async function startServer({
	dry = false,
	port,
	polling = true,
	quiet = false,
	tailnet,
} = {}) {
	const config = loadConfig();
	const ctx = {
		config,
		dry,
		port: port ?? config.port,
		owner: config.owner,
		tailnet: tailnet === undefined ? await tailnetName() : tailnet,
		loops: new Map(),
		errors: new Map(),
		clients: new Set(),
		say: (...a) =>
			quiet || console.log(new Date().toLocaleTimeString("en-GB", { hour12: false }), ...a),
	};
	ctx.push = (client, force = false) => {
		const body = JSON.stringify(stateOf(ctx, client.project));
		const h = hash(body);
		if (h === client.sent && !force) return;
		client.sent = h;
		client.res.write(`event: state\ndata: ${body}\n\n`);
	};
	ctx.broadcast = (force = false) => {
		for (const c of ctx.clients) ctx.push(c, force);
	};
	const server = http.createServer((req, res) => handle(ctx, req, res));
	await new Promise((resolve, reject) => {
		server.once("error", (e) =>
			reject(
				e.code === "EADDRINUSE"
					? new Error(`port ${ctx.port} is taken: is another rusuban running?`)
					: e,
			),
		);
		server.listen(ctx.port, "127.0.0.1", resolve);
	});
	ctx.port = server.address().port;
	// The judgments, answers and runs' logs change without the daemon: read again every 2 s.
	const timers = [
		setInterval(() => ctx.broadcast(), 2000),
		setInterval(() => {
			for (const c of ctx.clients) c.res.write(": ping\n\n");
		}, 15000),
	];
	// Tailscale may come up after the daemon, at logon: its name is asked again every 5 minutes.
	if (tailnet === undefined)
		timers.push(
			setInterval(async () => {
				ctx.tailnet = (await tailnetName()) ?? ctx.tailnet;
			}, 300_000),
		);
	if (polling) for (const p of config.projects) startLoop(ctx, p);
	ctx.say(
		`rusuban ${version} on http://127.0.0.1:${ctx.port}/${dry ? " (dry: no GitHub write, no agent)" : ""}`,
	);
	return {
		port: ctx.port,
		ctx,
		close: () => {
			for (const t of timers) clearInterval(t);
			for (const l of ctx.loops.values()) l.stop();
			for (const c of ctx.clients) c.res.end();
			return new Promise((resolve) => server.close(resolve));
		},
	};
}
