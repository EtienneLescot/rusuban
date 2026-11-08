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
import { branchRules, headChecks, mergePr, poll, readProject } from "./github.mjs";
import {
	append,
	homePath,
	journal,
	loadConfig,
	read,
	readJournal,
	readJsonl,
	sealMatches,
	validateConfig,
	write,
} from "./home.mjs";
import { hubState, lastIndex, openTerminal, readPage, replyTo, scanHub } from "./hub.mjs";
import {
	answerDesktop,
	answerOf,
	desktopAsks,
	lastProbes,
	probeMachines,
	pruneAsks,
	queueOf,
	releaseLease,
	saveProbes,
	tendLeases,
} from "./machines.mjs";
import {
	buildModel,
	bypassStops,
	checkAnswer,
	flatten,
	gatesOf,
	inboxOf,
	isEligible,
	keyOf,
	mergeOrdersOf,
	parseItem,
	refusedOf,
	todoOf,
} from "./model.mjs";
import { dashboardUrl, dispatch, sendPing } from "./pings.mjs";
import { loadRules, rulesChange } from "./rules.mjs";
import {
	changeSetting,
	confirmRequest,
	flagOutsideEdit,
	settingsCards,
	settingsLog,
} from "./settings.mjs";
import {
	busyRun,
	dueTasks,
	listTasks,
	readTask,
	startTask,
	tasksState,
	waiting,
} from "./tasks.mjs";
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
		startedAt: ctx.startedAt,
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
	const branches = new Set(repos.map((s) => liveFile.repos?.[s]?.defaultBranch).filter(Boolean));
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
			bypassApproval: p.bypassApproval,
			repos,
			observeOnly: repos.every((s) => rules[s]?.observeOnly !== false),
			defaultBranch: branches.size === 1 ? [...branches][0] : null,
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
// What reads GitHub, merges and starts agents; tests replace any of them through startServer.
const DEPS = {
	merge: mergePr,
	requestRun,
	requestCoordinator,
	read: readProject,
	loadRules,
	branchRules,
	headChecks,
	scanHub,
	openTerminal,
	tendLeases,
	probeMachines,
	releaseLease,
	dispatch,
	sendPing,
};
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

// The approval bypass (FR-029) merges with --admin, which skips every rule of the branch: the server
// reads them first and merges only if they would let this head through but for the approval. What
// stops it is journaled once per head, for the owner.
async function bypassStopsOf(pr, method, deps) {
	try {
		const [branch, checks] = await Promise.all([
			deps.branchRules(pr.repo, pr.base),
			deps.headChecks(pr.repo, pr.head),
		]);
		return bypassStops({ ...branch, ...checks, method, pr });
	} catch (e) {
		return [`the branch's rules or the head's checks could not be read: ${firstLine(e)}`];
	}
}

// The server's merge (T030, T093), one per cycle, never in a shadow project and never while the
// switch is paused, read again just before. A person's merge order comes first; then a PR judged
// `auto` whose every gate passes. A head GitHub refused is not tried again (T116), the journal being the record: only an order
// given after the refusal, or the bypass turned on since, tries it once more.
async function mergeOne(ctx, p, { live, judgment, answers, rules }, deps) {
	if (p.mode !== "live") return;
	const dir = `projects/${p.id}`;
	const said = readJsonl(`${dir}/journal.jsonl`);
	const refused = refusedOf(said);
	const armed = isArmed();
	const admin = p.bypassApproval === true && armed;
	const refusals = (pr) => refused.get(`${keyOf(pr)}@${pr.head}`) ?? [];
	const order = mergeOrdersOf({ live, judgment, answers, rules, armed }).find(
		(o) => o.eligible && !refusals(o.pr).some((r) => Date.parse(r.at) >= Date.parse(o.at)),
	);
	let pick = order && { pr: order.pr, gates: order.gates, card: order.card, by: order.by };
	if (!pick && armed)
		for (const pr of live.prs) {
			const j = judgment.items[keyOf(pr)];
			const gates = gatesOf(pr, j, { rules: rules[pr.repo], armed: true });
			if (
				j?.pr?.auto === true &&
				isEligible(gates) &&
				!refusals(pr).some((r) => r.admin === admin)
			) {
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
	if (admin) {
		const stops = await bypassStopsOf(pr, method, deps);
		if (stops.length) {
			if (!said.some((e) => e.kind === "bypass-stopped" && e.item === item && e.head === pr.head))
				journal(p.id, {
					kind: "bypass-stopped",
					item,
					text: `Not merged through the approval bypass on ${sha}: ${stops.join("; ")}.`,
					href: pr.url,
					by: "server",
					head: pr.head,
					notify: true,
				});
			return;
		}
	}
	try {
		await deps.merge({ slug: pr.repo, n: pr.n, method, head: pr.head, admin });
		const how = admin ? " through the approval bypass (--admin)" : "";
		journal(p.id, {
			kind: "merge",
			item,
			text: card
				? `Merged on @${pick.by ?? ctx.config.owner.login}'s order${how}: ${label}. ${gates.map((g) => g.name).join(", ")} green on ${sha}.`
				: `Merged alone${how}: ${label}. Every gate green on ${sha}.`,
			href: pr.url,
			by: "server",
			head: pr.head,
			method,
			admin,
			card: card ?? null,
			gates: gates.map(({ name, detail }) => `${name}: ${detail}`),
		});
		ctx.say(`${item} merged (${method}${admin ? ", --admin" : ""}, ${sha})`);
		// The card of an order is closed by the coordinator, which sees it carried out.
		if (card) deps.requestCoordinator(p.id, "merge");
		setTimeout(() => ctx.loops.get(p.id)?.refresh(), 15000).unref();
	} catch (e) {
		journal(p.id, {
			kind: "merge-refused",
			item,
			text: `GitHub refused the merge of ${sha}${admin ? " through the approval bypass" : ""}: ${firstLine(e)}`,
			href: pr.url,
			by: "server",
			head: pr.head,
			admin,
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
	const refused = refusedOf(readJsonl(`${dir}/journal.jsonl`));
	const todo = todoOf({ live, judgment, rules, refused });
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

// ── Recurring tasks (T041, T043) ──────────────────────────────────────────────────────────────
// A task's run, journaled by the daemon: started at its time, or on the owner's click.
function startTaskRun(ctx, t, trigger) {
	const r = startTask(t, trigger, depsOf(ctx).requestRun);
	const scheduled = trigger === "schedule";
	journal(t.project, {
		kind: "task",
		item: null,
		text: `Started the task “${t.title}”${scheduled ? " at its time" : ""}`,
		by: scheduled ? "server" : ctx.config.owner.login,
		run: r.id,
	});
	return r;
}

// Every 30 seconds: the tasks a slot is due for start (lock groups queue them one after the other),
// and what an ended task said goes to its project's journal, once; one that did not end well is
// flagged.
export function runSchedule(ctx, now = Date.now()) {
	if (ctx.dry) return [];
	const runs = listRuns();
	const started = dueTasks({ tasks: listTasks(ctx.config), runs, now }).map(({ task }) =>
		startTaskRun(ctx, task, "schedule"),
	);
	const said = new Map();
	for (const r of runs) {
		if (r.kind !== "task" || !r.task || waiting(r) || r.retriedBy) continue;
		if (!said.has(r.project))
			said.set(
				r.project,
				new Set(
					readJsonl(`projects/${r.project}/journal.jsonl`)
						.filter((e) => e.kind === "task-end")
						.map((e) => e.run),
				),
			);
		if (said.get(r.project).has(r.id)) continue;
		journal(r.project, {
			kind: "task-end",
			item: null,
			text: `${r.title ?? r.task}, ${r.state}: ${firstLine(r.summary ?? "no final answer").slice(0, 300)}`,
			by: "server",
			run: r.id,
			...(r.state === "done" ? {} : { notify: true }),
		});
	}
	if (started.length) ctx.broadcast?.(true);
	return started;
}

function runTaskNow(ctx, id, res) {
	const t = readTask(id, ctx.config);
	if (!t) return json(res, 404, { error: "no such task" });
	if (t.error) return json(res, 400, { error: t.error });
	if (busyRun(t.id)) return json(res, 409, { error: "this task already waits or works" });
	if (ctx.dry) return json(res, 200, { run: null, state: "dry" });
	const r = startTaskRun(ctx, t, "button");
	ctx.broadcast(true);
	return json(res, 200, { run: r.id, state: r.state });
}

// ── The daemon ────────────────────────────────────────────────────────────────────────────────
// One loop per project: its read, its rules, its merge and its agents, on its own files only. A loop
// stopped or replaced while it read (the project removed or changed) drops what it read.
function startLoop(ctx, p) {
	const dir = `projects/${p.id}`;
	const deps = depsOf(ctx);
	let loop = null;
	const current = () => ctx.loops.get(p.id) === loop;
	loop = poll(
		p,
		async (live, error) => {
			if (!current()) return;
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
					rules[slug] = await deps.loadRules(slug, branch, rules[slug]);
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
			if (!current()) return;
			write(`${dir}/rules.json`, rules);
			for (const { slug } of p.repos) journalRules(p.id, slug, before[slug], rules[slug]);
			ctx.errors.delete(p.id);
			try {
				await runCycle(ctx, p, live, rules, deps);
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
		{ initial: read(`${dir}/live.json`, null), read: deps.read },
	);
	ctx.loops.set(p.id, loop);
}

function stopLoop(ctx, id) {
	ctx.loops.get(id)?.stop();
	ctx.loops.delete(id);
	ctx.errors.delete(id);
}

// config.json is read again when it changes (`project add|remove|mode`), so no restart is needed: a
// new project starts its loop, a removed one stops, a changed one starts again with its settings. The
// settings module journals each change with its origin. A config that does not load leaves the
// running one.
export function reloadConfig(ctx) {
	const text = textOf(homePath("config.json"));
	if (text === null || text === ctx.configText) return;
	ctx.configText = text;
	let next;
	try {
		next = validateConfig(JSON.parse(text));
	} catch (e) {
		ctx.say(`config.json changed but is not applied: ${e.message.replace(/\n/g, " ")}`);
		return;
	}
	if (!sealMatches(next)) flagOutsideEdit(ctx.config, next); // T125
	const before = new Map(ctx.config.projects.map((p) => [p.id, p]));
	ctx.config = next;
	ctx.owner = next.owner;
	for (const id of before.keys())
		if (!next.projects.some((p) => p.id === id)) {
			stopLoop(ctx, id);
			ctx.say(`${id}: removed`);
		}
	for (const p of next.projects) {
		const old = before.get(p.id);
		if (JSON.stringify(old) === JSON.stringify(p)) continue;
		stopLoop(ctx, p.id);
		if (ctx.polling) startLoop(ctx, p);
		ctx.say(`${p.id}: ${old ? "changed" : "added"}`);
	}
	ctx.broadcast(true);
}

function send(res, status, type, body) {
	res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
	res.end(body);
}
const json = (res, status, v) =>
	send(res, status, "application/json; charset=utf-8", JSON.stringify(v));

// ── Cards, requests and runs (T037, T101) ─────────────────────────────────────────────────────
// The inbox: every project's cards waiting for their person, the settings waiting for the owner's
// confirmation, and what was flagged for the owner in the last 7 days (merges and pushes the server
// did not make, rules changes, refusals, settings that widened).
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
		.concat(settingsLog().filter((e) => e.notify && Date.parse(e.at) > week))
		.sort((a, b) => String(b.at).localeCompare(String(a.at)))
		.slice(0, 50);
	// The settings that wait for the owner (FR-092) and the desktops a run asks for (T070) are cards
	// like the others, newest first with them.
	const cards = [
		...inboxOf(projects),
		...settingsCards(ctx.config),
		...desktopCards(ctx.config),
	].sort((a, b) => String(b.card.createdAt).localeCompare(String(a.card.createdAt)));
	return { cards, flags };
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

// ── Machines (T067, T070, T071) ───────────────────────────────────────────────────────────────
// Each machine of the registry with its last probe and its queue, for the page and /api/machines.
export function machinesState(ctx) {
	const last = ctx.machines ?? lastProbes();
	const probes = new Map((last?.probes ?? []).map((p) => [p.name, p]));
	const queue = queueOf();
	return {
		checkedAt: last?.at ?? null,
		error: ctx.machinesError ?? null,
		machines: ctx.config.machines.map((m) => ({
			...m,
			probe: probes.get(m.name) ?? null,
			queue: queue[m.name] ?? [],
		})),
	};
}

// A run that only a person's desktop fits asks that person (FR-063): one card per desktop, until
// answered. The `lease` command waiting for it reads the answer.
function desktopCards(config) {
	return Object.values(desktopAsks()).flatMap((r) =>
		r.asks
			.filter((a) => !answerOf(r.run, a.machine))
			.map((a) => {
				const m = config.machines.find((x) => x.name === a.machine);
				const q = `Can a run take your desktop ${a.machine}?`;
				return {
					project: r.project,
					projectTitle: config.projects.find((p) => p.id === r.project)?.title ?? r.project,
					item: null,
					type: "lease",
					label: q,
					kind: null,
					author: null,
					url: null,
					itemOpen: true,
					judgedBy: null,
					evidence: null,
					card: {
						id: `lease:${r.run}:${a.machine}`,
						to: a.owner,
						urgency: "now",
						q,
						ctx: `Run ${r.run} asks for it: ${r.reason}. It works there as ${m?.agentUser ?? "its own account"}, ${m?.maxLeaseMin ?? 60} min at most.`,
						done: [],
						rec: null,
						why: null,
						options: [
							{ id: "allow", label: "Lend it", effect: "The run takes it at its next try." },
							{
								id: "deny",
								label: "Not now",
								effect: "The run is told no and goes on without it.",
							},
						],
						createdAt: r.at,
					},
				};
			}),
	);
}

// The owner's answer to a desktop's card: the `lease` command takes it, or stops waiting on a no.
async function confirmLease(ctx, body, res) {
	if (!["allow", "deny"].includes(body.option))
		return json(res, 400, { error: "a desktop's card is answered allow or deny" });
	const [, run, machine] = String(body.card).split(":");
	const r = desktopAsks()[run];
	if (!r?.asks.some((a) => a.machine === machine) || answerOf(run, machine))
		return json(res, 409, { error: "this request is answered or over" });
	const yes = body.option === "allow";
	await answerDesktop(run, machine, yes, ctx.config.owner.login);
	journal(r.project, {
		kind: "lease",
		item: null,
		text: yes ? `Lent ${machine} to run ${run}` : `Kept ${machine} from run ${run}`,
		by: ctx.config.owner.login,
		machine,
		run,
	});
	ctx.broadcast(true);
	return json(res, 200, { ok: true });
}

// "Release" in the Agents view: the lease ends whoever holds it, journaled as the owner's.
async function releaseMachine(ctx, name, res) {
	if (!ctx.config.machines.some((m) => m.name === name))
		return json(res, 404, { error: `no machine named ${name}` });
	const by = ctx.config.owner.login;
	const released = await depsOf(ctx).releaseLease(ctx.config, name, null, {
		log: (project, entry) => journal(project, { ...entry, by }),
	});
	ctx.passMachines?.();
	return json(res, 200, { released });
}

// The Agents view: every project's runs, the recurring tasks and the machines, pushed like the inbox
// (T043).
export const agentsState = (ctx) => ({
	dry: ctx.dry,
	runs: runsOf().slice(0, 40),
	tasks: tasksState(ctx.config),
	machines: machinesState(ctx),
});

// A run's log and a task's file, as text the page opens in a tab. A log's name comes from the run's
// status: a bare file name, never a path.
const textOf = (file) => {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
};
function runLog(id) {
	const r = readRun(id);
	return /^[\w.-]+\.log$/.test(r?.log ?? "") ? textOf(homePath(`runs/${id}/${r.log}`)) : null;
}
const text = (res, body) =>
	typeof body === "string"
		? send(res, 200, "text/plain; charset=utf-8", body)
		: json(res, 404, { error: "not found" });

// What reads, merges and starts agents, of which tests replace some through `startServer({ deps })`.
const depsOf = (ctx) => ({ ...DEPS, ...ctx.deps });

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

// ── Conversations (T058 to T060) ──────────────────────────────────────────────────────────────
// The list, filtered by project, item, origin or words of its title, and the index's age.
const conversationsOf = (ctx, q = new URLSearchParams()) => ({
	...hubState(ctx.hubIndex, ctx.config, {
		project: q.get("project"),
		item: q.get("item"),
		origin: q.get("origin"),
		q: q.get("q") ?? "",
	}),
	error: ctx.hubError ?? null,
});

// An answer from the dashboard starts a reply run (journaled as the owner's); "Open in terminal" opens
// a window of this machine, so it is refused from anywhere but this machine.
function converse(ctx, id, what, body, res, req) {
	try {
		if (what === "terminal") {
			if (!localHosts(ctx.port).includes(String(req.headers.host ?? "").toLowerCase()))
				return json(res, 403, { error: "a terminal opens only from this machine" });
			return json(res, 200, depsOf(ctx).openTerminal(ctx.hubIndex, id));
		}
		if (ctx.dry) return json(res, 200, { run: null, forked: false, state: "dry" });
		const r = replyTo(ctx.hubIndex, id, body.text, depsOf(ctx).requestRun);
		journal(r.project, {
			kind: "reply",
			item: null,
			text: `Answered the conversation “${r.title}”${r.forked ? " in a fork" : ""}`,
			by: ctx.config.owner.login,
			run: r.run,
		});
		ctx.broadcast(true);
		return json(res, 200, { run: r.run, forked: r.forked });
	} catch (e) {
		return json(res, e.status ?? 409, { error: firstLine(e) });
	}
}

// ── Pings (T065) ──────────────────────────────────────────────────────────────────────────────
// The inbox's cards go to the channels by their urgency (src/pings.mjs). The dispatcher's state
// between two calls is pings.json, the daemon's; a dry daemon pings no one. A card of the instance
// itself (a setting) journals a failed ping in the first project.
//
// What the journal flags for the owner pings too, once: a rules change, an approval bypass turned on,
// a merge or a push the server did not make go at once; the rest waits for the digest. A failed ping
// never pings, or a broken channel would loop.
const FLAGS_NOW = ["rules", "foreign-merge", "direct-push"];
export const flagsToPing = (flags, owner, base) =>
	flags
		.filter((f) => f.kind !== "ping-failed")
		.map((f) => ({
			project: f.project ?? null,
			item: f.item ?? null,
			label: f.project ?? "Rusuban",
			href: f.href ?? `${base}/`,
			card: {
				id: `flag:${f.project ?? "instance"}:${f.at}:${f.kind}`,
				q: f.text,
				to: owner,
				urgency:
					FLAGS_NOW.includes(f.kind) || f.setting === "project.bypass" || f.bypassOn?.length
						? "now"
						: "digest",
				createdAt: f.at,
			},
		}));
export async function pingOnce(ctx) {
	if (ctx.dry || ctx.pinging) return;
	ctx.pinging = true;
	try {
		const fallback = ctx.config.projects[0]?.id;
		const inbox = inboxState(ctx);
		const base = dashboardUrl({ owner: ctx.config.owner, port: ctx.port, tailnet: ctx.tailnet });
		const state = await depsOf(ctx).dispatch(
			{
				config: ctx.config,
				cards: [...inbox.cards, ...flagsToPing(inbox.flags, ctx.config.owner.login, base)],
				state: read("pings.json", {}),
				port: ctx.port,
				tailnet: ctx.tailnet,
			},
			{
				send: depsOf(ctx).sendPing,
				journal: (project, entry) => (project ?? fallback) && journal(project ?? fallback, entry),
			},
		);
		write("pings.json", state);
	} catch (e) {
		ctx.say(`pings: ${firstLine(e)}`);
	} finally {
		ctx.pinging = false;
	}
}

// A setting's card (FR-092): allowed, the change applies; declined, nothing changes. Never a note.
function confirmSetting(ctx, body, res) {
	if (!["allow", "deny"].includes(body.option))
		return json(res, 400, { error: "a setting is allowed or not, never answered in words" });
	let r;
	try {
		r = confirmRequest(body.card.slice("setting:".length), {
			allow: body.option === "allow",
			by: ctx.config.owner.login,
		});
	} catch (e) {
		return json(res, e.status ?? 409, { error: firstLine(e) });
	}
	reloadConfig(ctx);
	ctx.broadcast(true);
	return json(res, 200, { ok: true, state: r.state });
}

function answer(ctx, body, res) {
	if (String(body.card ?? "").startsWith("setting:")) return confirmSetting(ctx, body, res);
	if (String(body.card ?? "").startsWith("lease:")) return confirmLease(ctx, body, res);
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

async function post(ctx, path, body, res, req) {
	const conversation = /^\/api\/conversations\/([\w-]+)\/(reply|terminal)$/.exec(path);
	if (conversation) return converse(ctx, conversation[1], conversation[2], body, res, req);
	const by = ctx.config.owner.login;
	if (path === "/api/answer") return answer(ctx, body, res);
	if (path === "/api/ask") return ask(ctx, body, res);
	const releasing = /^\/api\/machines\/([^/]+)\/release$/.exec(path);
	if (releasing) return releaseMachine(ctx, decodeURIComponent(releasing[1]), res);
	const stopping = /^\/api\/runs\/([^/]+)\/stop$/.exec(path);
	if (stopping) return stop(ctx, decodeURIComponent(stopping[1]), res);
	const running = /^\/api\/tasks\/([^/]+)\/run$/.exec(path);
	if (running) return runTaskNow(ctx, decodeURIComponent(running[1]), res);
	if (path === "/api/automerge") {
		if (typeof body.armed !== "boolean")
			return json(res, 400, { error: "armed must be true or false" });
		// The owner's click in the dashboard is the confirmation itself (FR-092); the settings module
		// writes the switch and journals it for every project.
		changeSetting(
			{ kind: "switch", armed: body.armed },
			{ origin: "dashboard", by, confirmed: true },
		);
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
		if (req.method === "GET" && url.pathname === "/api/conversations")
			return json(res, 200, conversationsOf(ctx, url.searchParams));
		const reading = req.method === "GET" && /^\/api\/conversations\/([\w-]+)$/.exec(url.pathname);
		if (reading) {
			const before = url.searchParams.get("before");
			const page = await readPage(ctx.hubIndex, reading[1], { before });
			return page ? json(res, 200, page) : json(res, 404, { error: "no such conversation" });
		}
		if (req.method === "GET" && url.pathname === "/api/tasks")
			return json(res, 200, { tasks: tasksState(ctx.config) });
		if (req.method === "GET" && url.pathname === "/api/machines")
			return json(res, 200, machinesState(ctx));
		if (req.method === "GET" && url.pathname === "/api/runs")
			return json(res, 200, { runs: runsOf(url.searchParams.get("project")) });
		const log = req.method === "GET" && /^\/api\/runs\/([\w-]+)\/log$/.exec(url.pathname);
		if (log) return text(res, runLog(log[1]));
		const file = req.method === "GET" && /^\/api\/tasks\/([^/]+)\/file$/.exec(url.pathname);
		if (file)
			return text(res, readTask(file[1], ctx.config) && textOf(homePath(`tasks/${file[1]}.md`)));
		if (req.method === "GET" && url.pathname === "/api/events") {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				connection: "keep-alive",
			});
			const client = {
				res,
				project: url.searchParams.get("project"),
				sent: "",
				sentInbox: "",
				sentAgents: "",
				sentHub: "",
			};
			ctx.clients.add(client);
			ctx.push(client, true);
			req.on("close", () => ctx.clients.delete(client));
			return;
		}
		if (req.method === "POST") {
			const no = checkPost(req.headers, ctx);
			if (no) return json(res, no.status, { error: no.error });
			return await post(ctx, url.pathname, await readBody(req), res, req);
		}
		send(res, 404, "text/plain; charset=utf-8", "404");
	} catch (e) {
		if (!res.headersSent) json(res, e.status ?? 500, { error: firstLine(e) });
	}
}

// Starts the daemon. `polling: false` serves without reading GitHub nor starting tasks at their
// times (tests); `port` overrides the config's (0 picks a free one); `tailnet` sets the tailnet name
// instead of asking Tailscale; `deps` replaces what merges and starts agents (tests).
export async function startServer({
	dry = false,
	port,
	polling = true,
	quiet = false,
	tailnet,
	deps,
} = {}) {
	const configText = textOf(homePath("config.json")); // read first: a change in between is reloaded
	const config = loadConfig();
	if (!sealMatches(config)) flagOutsideEdit(null, config); // changed while the daemon was stopped
	const ctx = {
		config,
		configText,
		dry,
		polling,
		deps,
		port: port ?? config.port,
		startedAt: new Date().toISOString(),
		owner: config.owner,
		tailnet: tailnet === undefined ? await tailnetName() : tailnet,
		loops: new Map(),
		errors: new Map(),
		clients: new Set(),
		hubIndex: lastIndex(), // shown, with its age, until the first pass ends
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
		send("agents", agentsState(ctx), "sentAgents");
		send("hub", conversationsOf(ctx), "sentHub");
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
	// The judgments, answers, runs' logs and the config change without the daemon: read again every 2 s.
	const timers = [
		setInterval(() => {
			reloadConfig(ctx);
			ctx.broadcast();
		}, 2000),
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
	// The conversations hub (T105): a pass at start, then every 30 s, one at a time, new bytes only.
	let scanning = false;
	const passHub = async () => {
		if (scanning) return;
		scanning = true;
		try {
			ctx.hubIndex = await depsOf(ctx).scanHub({ config: ctx.config });
			ctx.hubError = null;
		} catch (e) {
			ctx.hubError = firstLine(e);
		} finally {
			scanning = false;
			ctx.broadcast();
		}
	};
	if (polling) {
		passHub();
		timers.push(setInterval(passHub, 30_000));
	}
	// Machines (T067): every 2 min, the leases tended first (renewed, or freed when their run died or
	// ran out), then every machine probed. The probe is saved for the agents' context too.
	let probing = false;
	ctx.passMachines = async () => {
		if (probing || !ctx.config.machines.length) return;
		probing = true;
		try {
			const deps = depsOf(ctx);
			await deps.tendLeases(ctx.config);
			await pruneAsks();
			ctx.machines = saveProbes(await deps.probeMachines(ctx.config));
			ctx.machinesError = null;
		} catch (e) {
			ctx.machinesError = firstLine(e);
		} finally {
			probing = false;
			ctx.broadcast();
		}
	};
	if (polling) {
		ctx.passMachines();
		timers.push(setInterval(ctx.passMachines, 120_000));
	}
	// Pings (T065): every minute, never two at once.
	if (polling && !dry) {
		pingOnce(ctx);
		timers.push(setInterval(() => pingOnce(ctx), 60_000));
	}
	// Recurring tasks: their slots are looked at every 30 s, and once at start for those missed.
	const schedule = () => {
		try {
			for (const r of runSchedule(ctx)) ctx.say(`task ${r.task}: started (${r.id})`);
		} catch (e) {
			ctx.say(`tasks: ${firstLine(e)}`);
		}
	};
	if (polling && !dry) {
		schedule();
		timers.push(setInterval(schedule, 30_000));
	}
	ctx.say(
		`rusuban ${version} on http://127.0.0.1:${ctx.port}/${dry ? " (dry: no GitHub write, no agent)" : ""}`,
	);
	return {
		port: ctx.port,
		ctx,
		close: () => {
			for (const t of timers) clearInterval(t);
			for (const id of [...ctx.loops.keys()]) stopLoop(ctx, id); // a late refresh finds none
			for (const c of ctx.clients) c.res.end();
			// A page reopens its stream at once, on a connection it keeps: those are cut, or close waits.
			const closed = new Promise((resolve) => server.close(resolve));
			server.closeAllConnections();
			return closed;
		},
	};
}
