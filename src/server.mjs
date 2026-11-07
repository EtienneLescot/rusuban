// The daemon. It reads every project's repos and rules on their own clock, computes the model, and
// serves the dashboard with its live stream, on 127.0.0.1 only. Remote access goes through Tailscale
// Serve, whose identity header must be the owner's Tailscale login (research R7). After each read it
// merges what is eligible, flags what it did not do, and starts agents when something waits for
// them. `dry` reads and shows only: no merge, no agent.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import {
	busy,
	coordinatorLock,
	kickQueues,
	listRuns,
	pendingOf,
	readRun,
	requestCoordinator,
	requestRun,
	stopRun,
} from "./agents.mjs";
import { mergePr, poll } from "./github.mjs";
import {
	append,
	homePath,
	journal,
	loadConfig,
	read,
	readJournal,
	readJsonl,
	write,
} from "./home.mjs";
import {
	buildModel,
	checkAnswer,
	flatten,
	gatesOf,
	inboxOf,
	isEligible,
	keyOf,
	mergeOrdersOf,
	parseItem,
	todoOf,
} from "./model.mjs";
import { loadRules, rulesChange } from "./rules.mjs";
import { cleanStale } from "./workers.mjs";

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
				retryAt,
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
				retryAt: retryAt ?? null,
			}),
		),
		journal: journalAll.slice(-40).reverse(),
	};
}

// ── One cycle, after each read of a project ───────────────────────────────────────────────────
const DEPS = { merge: mergePr, requestRun, requestCoordinator };
const since = (iso, ref) => Date.parse(iso) >= Date.parse(ref);

// A rules change applies at once, journaled with its diff for the owner (FR-027); so is a locks.json
// that does not parse, which stops every merge of its repo until it is fixed.
export function journalRules(project, slug, prev, next) {
	if (!next || next.error) return;
	const change = rulesChange(prev, next);
	const invalid = next.errors?.length
		? `locks.json is invalid (${next.errors.join("; ")}): nothing merges in ${slug} until it is fixed.`
		: "";
	const href = `https://github.com/${slug}/tree/${next.ref}/.rusuban`;
	if (change)
		journal(project, {
			kind: "rules",
			item: null,
			text: `Rules of ${slug} changed: ${change.files.join(", ")}. They apply from now on.${invalid ? ` ${invalid}` : ""}`,
			href,
			diff: change.diff,
			by: "server",
			notify: true,
		});
	else if (invalid && prev?.treeSha !== next.treeSha)
		journal(project, {
			kind: "locks-invalid",
			item: null,
			text: invalid,
			href,
			by: "server",
			notify: true,
		});
}

// The server's merge (T030, T093), one per cycle and never in a shadow project. A person's merge
// order comes first; then a PR judged `auto` whose every gate passes, the switch read again just
// before. A head GitHub refused is not tried again.
async function mergeOne(ctx, p, { live, judgment, answers, rules }, deps) {
	if (p.mode !== "live") return;
	const tried = (pr) => ctx.mergeFailed.get(keyOf(pr)) === pr.head;
	const order = mergeOrdersOf({ live, judgment, answers, rules }).find(
		(o) => o.eligible && !tried(o.pr),
	);
	let pick = order && { pr: order.pr, gates: order.gates, card: order.card, by: order.by };
	if (!pick && isArmed())
		for (const pr of live.prs) {
			const j = judgment.items[keyOf(pr)];
			const gates = gatesOf(pr, j, { rules: rules[pr.repo], armed: true });
			if (j?.pr?.auto === true && isEligible(gates) && !tried(pr)) {
				pick = { pr, gates };
				break;
			}
		}
	if (!pick) return;
	const { pr, gates, card } = pick;
	const item = keyOf(pr);
	const method = rules[pr.repo]?.locks?.mergeMethod ?? "rebase";
	const label = judgment.items[item]?.label || pr.title;
	const sha = pr.head.slice(0, 7);
	try {
		await deps.merge({ slug: pr.repo, n: pr.n, method, head: pr.head });
		journal(p.id, {
			kind: "merge",
			item,
			text: card
				? `Merged on @${pick.by ?? ctx.config.owner.login}'s order: ${label}. ${gates.map((g) => g.name).join(", ")} green on ${sha}.`
				: `Merged alone: ${label}. Every gate green on ${sha}.`,
			href: pr.url,
			by: "server",
			head: pr.head,
			method,
			card: card ?? null,
			gates: gates.map(({ name, detail }) => `${name}: ${detail}`),
		});
		ctx.say(`${item} merged (${method}, ${sha})`);
		// The card of an order is closed by the coordinator, which sees it carried out.
		if (card) deps.requestCoordinator(p.id, "merge");
		setTimeout(() => ctx.loops.get(p.id)?.refresh(), 15000).unref();
	} catch (e) {
		ctx.mergeFailed.set(item, pr.head);
		journal(p.id, {
			kind: "merge-refused",
			item,
			text: `GitHub refused the merge of ${sha}: ${firstLine(e)}`,
			href: pr.url,
			by: "server",
			head: pr.head,
			notify: true,
		});
		ctx.say(`${item}: merge refused: ${firstLine(e)}`);
	}
}

// Merges and pushes the server did not make (T031, T092), each flagged once in the journal for the
// owner. Only what happened after the project was first watched: an install does not flag the past.
function flagOutsiders(p, liveFile) {
	const dir = `projects/${p.id}`;
	const saved = read(`${dir}/flags.json`, null);
	const flags = saved ?? { since: new Date().toISOString(), seen: {} };
	const ours = new Set(
		readJsonl(`${dir}/journal.jsonl`)
			.filter((e) => e.kind === "merge" && e.by === "server")
			.map((e) => e.item),
	);
	let changed = !saved;
	const flag = (key, entry) => {
		if (flags.seen[key]) return;
		flags.seen[key] = new Date().toISOString();
		changed = true;
		journal(p.id, { ...entry, by: "server", notify: true });
	};
	for (const [slug, r] of Object.entries(liveFile.repos ?? {})) {
		for (const m of r.merged ?? [])
			if (since(m.mergedAt, flags.since) && !ours.has(keyOf(m)))
				flag(`merge:${keyOf(m)}`, {
					kind: "foreign-merge",
					item: keyOf(m),
					text: `Merged by @${m.mergedBy ?? "someone"}, not by Rusuban: ${m.title}`,
					href: m.url,
				});
		for (const c of r.pushes ?? [])
			if (since(c.at, flags.since))
				flag(`push:${c.oid}`, {
					kind: "direct-push",
					item: null,
					text: `Pushed straight to ${r.defaultBranch} of ${slug}${c.author ? ` by ${c.author}` : ""}, outside any PR: ${c.headline} (${c.oid.slice(0, 7)})`,
					href: c.url,
				});
	}
	// GitHub shows 7 days: what was seen more than 14 days ago cannot come back.
	for (const [k, at] of Object.entries(flags.seen))
		if (Date.now() - Date.parse(at) > 14 * 86400e3) {
			delete flags.seen[k];
			changed = true;
		}
	if (changed) write(`${dir}/flags.json`, flags);
}

// Agents start on change, not on a clock (T029): a judge when the project's todo changes, a
// coordinator when answers, requests or worker reports wait. A project without rules has no todo, so
// no judge ever starts there. The same todo starts nothing twice, unless its run failed 15 minutes
// ago or more.
function triggerRuns(p, { live, judgment, rules }, deps) {
	const dir = `projects/${p.id}`;
	const t = read(`${dir}/triggers.json`, {});
	const fire = (kind, sig, request) => {
		const last = t[kind];
		const run = last?.run ? readRun(last.run) : null;
		const failed =
			["failed", "interrupted", "stopped"].includes(run?.state) &&
			Date.now() - Date.parse(run.endedAt ?? last.at) > 15 * 60e3;
		if (last?.sig === sig && !failed) return false;
		const r = request();
		if (!r) return false;
		t[kind] = { sig, at: new Date().toISOString(), run: r.id };
		return true;
	};
	const todo = todoOf({ live, judgment, rules });
	const judge =
		todo.length > 0 &&
		!busy(p.id, "judge") &&
		fire(
			"judge",
			hash(
				todo
					.map((x) => `${x.item}:${x.reason}:${x.head ?? ""}`)
					.sort()
					.join(),
			),
			() =>
				deps.requestRun({
					kind: "judge",
					project: p.id,
					items: [...new Set(todo.map((x) => x.item))],
					lock: coordinatorLock(p.id),
					trigger: "change",
				}),
		);
	const pending = pendingOf(p.id);
	const waiting = [
		...pending.answers.map((a) => `answer:${a.card}:${a.at}`),
		...pending.asks.map((a) => `ask:${a.at}`),
		...pending.reports.map((r) => `report:${r.run}`),
	];
	// A coordinator at work takes what is new when it ends; a second one would find nothing.
	const act =
		waiting.length > 0 &&
		!busy(p.id, "act") &&
		fire("act", hash(waiting.join()), () => deps.requestCoordinator(p.id, "change"));
	if (judge || act) write(`${dir}/triggers.json`, t);
}

export async function runCycle(ctx, p, liveFile, rules, deps = DEPS) {
	const dir = `projects/${p.id}`;
	const live = flatten(liveFile);
	const judgment = read(`${dir}/judgment.json`, { items: {} });
	const answers = readJsonl(`${dir}/answers.jsonl`);
	if (!ctx.dry) await mergeOne(ctx, p, { live, judgment, answers, rules }, deps);
	flagOutsiders(p, liveFile);
	if (!ctx.dry) triggerRuns(p, { live, judgment, rules }, deps);
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
			const before = { ...rules };
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
			for (const { slug } of p.repos) journalRules(p.id, slug, before[slug], rules[slug]);
			ctx.errors.delete(p.id);
			try {
				await runCycle(ctx, p, live, rules, depsOf(ctx));
			} catch (e) {
				ctx.say(`${p.id}: cycle failed: ${firstLine(e)}`);
			}
			if (!ctx.dry) kickQueues();
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

// ── Cards, requests and runs (T037, T101) ─────────────────────────────────────────────────────
// The inbox: every project's cards waiting for their person, and what the server flagged for the
// owner in the last 7 days (merges and pushes it did not make, rules changes, refusals).
export function inboxState(ctx) {
	const week = Date.now() - 7 * 86400e3;
	const projects = ctx.config.projects.map((p) => {
		const dir = `projects/${p.id}`;
		return {
			id: p.id,
			title: p.title,
			live: flatten(read(`${dir}/live.json`, {})),
			judgment: read(`${dir}/judgment.json`, { items: {} }),
			answers: readJsonl(`${dir}/answers.jsonl`),
		};
	});
	const flags = ctx.config.projects
		.flatMap((p) =>
			readJsonl(`projects/${p.id}/journal.jsonl`)
				.filter((e) => e.notify && Date.parse(e.at) > week)
				.map((e) => ({ project: p.id, ...e })),
		)
		.sort((a, b) => String(b.at).localeCompare(String(a.at)))
		.slice(0, 50);
	return { cards: inboxOf(projects), flags };
}

// Runs, at work first: running, queued, waiting for a usage limit, then the ended ones, newest first.
const RANK = { running: 0, queued: 1, limited: 2 };
export const runsOf = (project = null) =>
	listRuns(project)
		.sort((a, b) => (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3))
		.slice(0, 100)
		.map((r) => ({
			id: r.id,
			project: r.project,
			kind: r.kind,
			title: r.title ?? null,
			items: r.items ?? [],
			state: r.state,
			step: r.step ?? null,
			trigger: r.trigger ?? null,
			createdAt: r.createdAt ?? null,
			startedAt: r.startedAt ?? null,
			endedAt: r.endedAt ?? null,
			retryAt: r.retryAt ?? null,
			summary: r.summary ?? null,
			conversation: r.session ?? null,
		}));

// The agents' starters, which tests replace through `startServer({ deps })`.
const depsOf = (ctx) => ctx.deps ?? DEPS;

// The coordinator starts at once on an answer or a request (FR-043), unless the daemon is dry.
const startCoordinator = (ctx, project, trigger) =>
	ctx.dry ? "dry" : (depsOf(ctx).requestCoordinator(project, trigger)?.state ?? "queued");

const itemOf = (p, ref) => {
	try {
		return parseItem(
			ref,
			p.repos.map((r) => r.slug),
		);
	} catch (e) {
		throw Object.assign(e, { status: 400 });
	}
};

function answer(ctx, body, res) {
	const p = ctx.config.projects.find((x) => x.id === body.project);
	if (!p) return json(res, 404, { error: "unknown project" });
	const dir = `projects/${p.id}`;
	const item = itemOf(p, body.item);
	const judgment = read(`${dir}/judgment.json`, { items: {} });
	const answers = readJsonl(`${dir}/answers.jsonl`);
	const { card, option, note } = body;
	const checked = checkAnswer({ judgment, answers, item, card, option, note });
	if (checked.error) return json(res, checked.status, { error: checked.error });
	const by = ctx.config.owner.login;
	append(`${dir}/answers.jsonl`, {
		at: new Date().toISOString(),
		item,
		card: body.card,
		option: checked.chosen ? body.option : "other",
		note: checked.note,
		by,
	});
	journal(p.id, {
		kind: "answer",
		item,
		text: `Answered: ${(checked.chosen?.label ?? checked.note).slice(0, 200)}`,
		by,
	});
	// A merge order is the server's: the next read carries it out.
	if (checked.chosen?.merge && !ctx.dry) ctx.loops.get(p.id)?.refresh();
	const coordinator = startCoordinator(ctx, p.id, "answer");
	ctx.broadcast(true);
	return json(res, 200, { ok: true, coordinator });
}

function ask(ctx, body, res) {
	const p = ctx.config.projects.find((x) => x.id === body.project);
	if (!p) return json(res, 404, { error: "unknown project" });
	const text = typeof body.text === "string" ? body.text.trim() : "";
	if (!text) return json(res, 400, { error: "the request is empty" });
	if (text.length > 4000) return json(res, 400, { error: "the request is over 4000 characters" });
	const item = body.item ? itemOf(p, body.item) : null;
	const by = ctx.config.owner.login;
	append(`projects/${p.id}/asks.jsonl`, { at: new Date().toISOString(), text, item, by });
	journal(p.id, { kind: "ask", item, text: `Asked: ${text.slice(0, 200)}`, by });
	const coordinator = startCoordinator(ctx, p.id, "ask");
	ctx.broadcast(true);
	return json(res, 200, { ok: true, coordinator });
}

function stop(ctx, id, res) {
	const run = /^[\w.-]+$/.test(id) ? readRun(id) : null;
	if (!run) return json(res, 404, { error: "no such run" });
	if (!["queued", "running"].includes(run.state))
		return json(res, 409, { error: `the run is already ${run.state}` });
	const by = ctx.config.owner.login;
	const stopped = stopRun(id, `Stopped by @${by} from the dashboard.`);
	journal(run.project, {
		kind: "stop",
		item: run.items?.[0] ?? null,
		text: `Stopped the ${run.kind} run${run.title ? ` ${run.title}` : ""}`,
		by,
	});
	ctx.broadcast(true);
	return json(res, 200, { state: stopped.state });
}

async function post(ctx, path, body, res) {
	const by = ctx.config.owner.login;
	if (path === "/api/answer") return answer(ctx, body, res);
	if (path === "/api/ask") return ask(ctx, body, res);
	const stopping = /^\/api\/runs\/([^/]+)\/stop$/.exec(path);
	if (stopping) return stop(ctx, decodeURIComponent(stopping[1]), res);
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
		if (req.method === "GET" && url.pathname === "/api/inbox")
			return json(res, 200, inboxState(ctx));
		if (req.method === "GET" && url.pathname === "/api/runs")
			return json(res, 200, { runs: runsOf(url.searchParams.get("project")) });
		if (req.method === "GET" && url.pathname === "/api/events") {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				connection: "keep-alive",
			});
			const client = { res, project: url.searchParams.get("project"), sent: "", sentInbox: "" };
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
// config's (0 picks a free one); `tailnet` sets the tailnet name instead of asking Tailscale; `deps`
// replaces what merges and starts agents (tests).
export async function startServer({
	dry = false,
	port,
	polling = true,
	quiet = false,
	tailnet,
	deps,
} = {}) {
	const config = loadConfig();
	const ctx = {
		config,
		dry,
		deps,
		port: port ?? config.port,
		owner: config.owner,
		tailnet: tailnet === undefined ? await tailnetName() : tailnet,
		mergeFailed: new Map(), // item → the head GitHub refused to merge
		loops: new Map(),
		errors: new Map(),
		clients: new Set(),
		say: (...a) =>
			quiet || console.log(new Date().toLocaleTimeString("en-GB", { hour12: false }), ...a),
	};
	// Each client gets the state of its project and the inbox of all projects, each when it changes.
	ctx.push = (client, force = false) => {
		const send = (event, value, key) => {
			const body = JSON.stringify(value);
			const h = hash(body);
			if (h === client[key] && !force) return;
			client[key] = h;
			client.res.write(`event: ${event}\ndata: ${body}\n\n`);
		};
		send("state", stateOf(ctx, client.project), "sent");
		send("inbox", inboxState(ctx), "sentInbox");
	};
	// A state file the model cannot read (cut short, from an older version) costs the page one update,
	// never the daemon nor a write that already happened: said once per distinct error.
	let lastError = null;
	ctx.broadcast = (force = false) => {
		for (const c of ctx.clients)
			try {
				ctx.push(c, force);
			} catch (e) {
				if (firstLine(e) === lastError) continue;
				lastError = firstLine(e);
				ctx.say(`page update failed: ${lastError}`);
			}
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
	for (const p of config.projects)
		cleanStale(
			p.id,
			p.repos.map((r) => r.slug),
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
