// The Rusuban dashboard. It shows the model the server pushes (SSE) and computes none of it: only
// the view (project, zoom, pan, expanded nodes, filters) and clicks live here.
const W = 232;
const PY = 38;

// ── Every string of the page ──────────────────────────────────────────────────────────────────
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const T = {
	brand: "Rusuban",
	project: "Project",
	github: "GitHub",
	refreshNow: "Read GitHub now",
	agents: "Agents",
	agentsDrawer: "Agents and journal",
	autoMerge: "Auto-merge",
	forYou: "for you",
	view: "View",
	graph: "Graph",
	kanban: "Kanban",
	paused: "Auto-merge is paused: no PR is merged without you.",
	observeOnly:
		"Observe only: no repo of this project has rules in .rusuban/rules/ yet. Agents read it and never act.",
	dry: "Dry mode: the server starts no agent and writes nothing on GitHub.",
	shadow:
		"Shadow mode: agents judge and propose, nothing is written on GitHub and nothing is merged.",
	offline: "Server unreachable: the display is frozen.",
	filters: "Filters",
	areaFrames: "Area frames",
	issue: "Issue",
	pr: "PR",
	agentOnIt: "An agent is on it",
	edgeAddresses: "addresses",
	edgeBefore: "goes first",
	edgeFiles: "same files",
	edgeMain: "to the default branch",
	zoomOut: "Zoom out",
	zoomIn: "Zoom in",
	fit: "Fit",
	collapse: "Collapse all",
	minimap: "Minimap",
	doneWithoutYou: "Done without you",
	groups: { all: "All", mine: "Yours", agent: "Agents", others: "Waiting on others" },
	allKinds: "All kinds",
	kinds: {
		bug: "Bug",
		feature: "Feature",
		maintenance: "Maintenance",
		docs: "Docs",
		translation: "Translation",
		question: "Question",
		other: "Other",
	},
	toJudge: "To judge",
	yours: "Yours",
	agent: "Agent",
	someone: "someone",
	fold: "fold",
	unfold: "unfold",
	openOnGitHub: (num) => `Open ${num} on GitHub`,
	onGitHub: (num) => `${num} on GitHub`,
	agentAtWork: (a) => `An agent is on it · ${a.name}${a.step ? `: ${a.step}` : ""}`,
	answerApplying: "✓ Answer recorded, an agent applies it",
	cardSettled: "✓ Your decision is applied",
	cardReplaced: "✓ Card replaced by a new judgment",
	waitsForYou: "Waits for your answer",
	readyNext: "Ready: merges at the next read",
	readyPaused: "Ready, auto-merge paused",
	readyShadow: "Ready, shadow mode",
	observedOnly: "Observed only: this repo has no rules",
	yoursToDecide: (kind) => `${kind} · yours to decide`,
	waitsFor: (kind, who) => `${kind} · waits for ${who}`,
	toBeJudged: "To be judged by an agent",
	agentState: (kind, state) => `${kind} · ${state}`,
	agentOnItShort: "an agent is on it",
	revisitOverdue: "revisit overdue",
	followed: "followed by the agents",
	repoObserved: "This repo has no rules yet: agents only read it.",
	decision: "Decision",
	agentDid: "The agent did",
	yourDecision: "Your decision",
	decisionFor: (login) => `Decision for @${login}`,
	agentRecommends: "The agent recommends",
	options: "Options",
	githubMessage: "Posted on GitHub:",
	answerRecorded: (label) => `Your answer is recorded: “${label}”`,
	agentApplies: "An agent applies it.",
	settledTitle: (state, choice) =>
		`${state === "replaced" ? "Card replaced" : "Decision applied"}${choice ? `: “${choice}”` : ""}`,
	next: "Next",
	blockedBy: "Blocked by",
	backToAgents: "Back to the agents",
	mergeGates: "Merge gates",
	afterYourAnswer: "After your answer",
	linkedTo: "Linked to",
	noArea: "No area",
	groupFrame: (group, count) => `${T.groups[group]} · unlinked · ${count}`,
	mainTitle: "default branch",
	mainFlow: (inFlight, ready) => `Auto-merge · ${inFlight} on the way, ${ready} ready`,
	mainMerged: (n, auto) => `${plural(n, "PR")} merged in 7 days, ${auto} without you`,
	seeInGraph: "See it in the graph",
	merged7: "Merged · 7 days",
	auto: "auto",
	mergedAgo: (when, author) => `Merged ${when}${author ? ` · @${author}` : ""}`,
	starting: "starting",
	queued: "queued",
	idle: "idle",
	idleSince: (when) => `idle · last run ${when}`,
	runningCount: (n, names) => `${plural(n, "run")} · ${names}`,
	reading: "reading GitHub",
	readAgo: (when) => `read ${when}`,
	stale: (label) => `${label}, stale`,
	limitedUntil: (time) => `limited until ${time}`,
	notReadYet: "not read yet",
	readError: (when, error) => `error ${when}: ${error}`,
	githubError: (error) => `Last read failed: ${error}`,
	agentsNow: "Agents now",
	close: "Close",
	idleLong: "Idle.",
	recentRuns: "Recent runs",
	none: "None.",
	journal: "Journal",
	emptyJournal: "Empty for now.",
	runState: {
		done: "done",
		failed: "failed",
		stopped: "stopped",
		interrupted: "interrupted",
		limited: "usage limit",
	},
	rulesAndLocks: "Rules and locks",
	rulesNotLoaded: "Rules not read yet.",
	repoObserveOnly: "Observe only: add .rusuban/rules/*.md on the default branch to let agents act.",
	rulesFiles: (files) => `Rules: ${files.join(", ")}`,
	lockNames: {
		mergeMethod: "Merge method",
		lockedPaths: "Locked paths",
		maxLines: "Max lines",
		maxFiles: "Max files",
		sizeExempt: "Not counted in size",
		requiredChecks: "Required checks",
		requiredReviewers: "Required reviewers",
		evidence: "Proof needed",
	},
	builtInLocks: "Built-in locks, in every project",
	builtIn: [
		"CI green on the exact head",
		"No open review thread",
		"Head unchanged since the judgment",
		"A PR that changes .rusuban/ is merged by a person",
		"Never a direct push to the default branch",
		"The auto-merge switch pauses every merge",
	],
	never: "never",
	ago: (span) => `${span} ago`,
	in: (span) => `in ${span}`,
	switchFailed: (error) => `Switch refused: ${error}`,
	refreshFailed: (error) => `Read refused: ${error}`,
};

const KIND_COLOR = {
	bug: "#f59e0b",
	feature: "#60a5fa",
	maintenance: "#a1a1aa",
	docs: "#94a3b8",
	translation: "#c084fc",
	question: "#a1a1aa",
	other: "#71717a",
};
const UNJUDGED_COLOR = "#71717a";
const GATE = {
	ok: "#34b27b",
	wait: "#f59e0b",
	fail: "#ef4444",
	todo: "rgba(255,255,255,0.24)",
	na: "rgba(255,255,255,0.08)",
};
const $ = (id) => document.getElementById(id);
const esc = (s) =>
	String(s ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);

// The static text of index.html comes from T too.
for (const el of document.querySelectorAll("[data-t]")) el.textContent = T[el.dataset.t];
for (const el of document.querySelectorAll("[data-t-title]")) el.title = T[el.dataset.tTitle];
for (const el of document.querySelectorAll("[data-t-label]"))
	el.setAttribute("aria-label", T[el.dataset.tLabel]);

// ── Local view, kept in the browser (convenience only) ────────────────────────────────────────
const saved = (() => {
	try {
		return JSON.parse(localStorage.getItem("rusuban.view") ?? "null");
	} catch {
		return null;
	}
})();
const ui = {
	z: 0.6,
	px: 40,
	py: 60,
	own: "all",
	kind: "all",
	themes: true,
	// A phone opens on the kanban, readable at that width; the graph is one tap away.
	view: matchMedia("(max-width: 720px)").matches ? "kanban" : "graph",
	project: null,
	...saved,
	exp: new Set(saved?.exp ?? []),
	fitted: !!saved,
};
if (!(ui.z >= 0.1 && ui.z <= 1.6)) Object.assign(ui, { z: 0.6, fitted: false });
const save = () => {
	try {
		localStorage.setItem("rusuban.view", JSON.stringify({ ...ui, exp: [...ui.exp] }));
	} catch {}
};

let S = null; // the last state the server pushed

// GitHub's icons: a dotted circle for an issue, a branch that joins back for a PR (Lucide).
const ICON = {
	issue:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
	pr: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>',
};
// The small pixel crab marks where an agent is at work.
const CRAB =
	'<svg class="crab-svg" viewBox="0 0 16 12" aria-hidden="true" shape-rendering="crispEdges"><rect x="2" y="1" width="12" height="7" fill="#d97757"/><rect x="0" y="3" width="2" height="3" fill="#d97757"/><rect x="14" y="3" width="2" height="3" fill="#d97757"/><rect x="5" y="3" width="1" height="2" fill="#1a0f0b"/><rect x="10" y="3" width="1" height="2" fill="#1a0f0b"/><rect x="3" y="8" width="1" height="3" fill="#d97757"/><rect x="5" y="8" width="1" height="3" fill="#d97757"/><rect x="10" y="8" width="1" height="3" fill="#d97757"/><rect x="12" y="8" width="1" height="3" fill="#d97757"/></svg>';
const EXT =
	'<svg class="ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>';
const CHECK =
	'<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

// ── Labels ────────────────────────────────────────────────────────────────────────────────────
const groupOf = (n) => (n.owner === S.me ? "mine" : n.owner === "agent" ? "agent" : "others");
const multiRepo = () => (S?.project?.repos.length ?? 0) > 1;
const numOf = (repo, n) => (multiRepo() ? `${String(repo).split("/")[1]}#${n}` : `#${n}`);
const numOfKey = (key) => {
	const [repo, n] = String(key).split("#");
	return numOf(repo, n);
};
const ghLink = (n) =>
	`<a class="num" href="${esc(n.url)}" target="_blank" rel="noopener" title="${esc(T.openOnGitHub(numOf(n.repo, n.n)))}">${esc(numOf(n.repo, n.n))}${EXT}</a>`;
const crab = (n) =>
	n.activity ? `<span class="crab" title="${esc(T.agentAtWork(n.activity))}">${CRAB}</span>` : "";
const typeTag = (type, color) =>
	`<span class="ttag" style="color:${color}">${ICON[type]}<b>${type === "pr" ? T.pr : T.issue}</b></span>`;
const kindColor = (n) => (n.unjudged ? UNJUDGED_COLOR : (KIND_COLOR[n.kind] ?? UNJUDGED_COLOR));
const kindLabel = (n) => (n.unjudged ? T.toJudge : (T.kinds[n.kind] ?? n.kind ?? T.toJudge));
const ownerClass = (n) => (n.unjudged ? "unjudged" : groupOf(n));
const ownLabel = (n) => {
	if (n.unjudged) return T.toJudge;
	if (n.owner === S.me) return T.yours;
	if (n.owner === "agent") return T.agent;
	if (n.owner === "third") return n.waits || T.someone;
	return `@${n.owner}`;
};
const answerOf = (n) =>
	n.decision?.answer
		? (n.decision.options.find((o) => o.id === n.decision.answer.option)?.label ??
			n.decision.answer.note)
		: null;
const recentlySettled = (n) =>
	!n.decision && n.settled && Date.now() - Date.parse(n.settled.at) < 2 * 3600e3;

function subOf(n) {
	if (answerOf(n)) return { t: T.answerApplying, c: "#4ade80" };
	if (recentlySettled(n))
		return { t: n.settled.state === "replaced" ? T.cardReplaced : T.cardSettled, c: "#4ade80" };
	if (n.type === "pr") {
		if (n.owner === S.me) return { t: T.waitsForYou, c: "#4ade80" };
		if (n.eligible) return { t: T.readyNext, c: "#4ade80" };
		// The switch is a banner of its own: the line under a PR names what else stops it.
		const gates = n.gates.filter((g) => g.name !== "Switch");
		if (gates.every((g) => g.state === "ok" || g.state === "na"))
			return { t: S.project?.mode === "shadow" ? T.readyShadow : T.readyPaused, c: "#fbbf24" };
		const g =
			gates.find((x) => x.state === "fail") ??
			gates.find((x) => x.state === "wait") ??
			gates.find((x) => x.state === "todo");
		if (!g) return { t: "", c: "" };
		return {
			t: `${g.name}: ${g.detail}`,
			c: g.state === "fail" ? "#f87171" : g.state === "wait" ? "#fbbf24" : "#a1a1aa",
		};
	}
	const kind = kindLabel(n);
	if (n.observeOnly && n.unjudged) return { t: T.observedOnly, c: "#a1a1aa" };
	if (n.owner === S.me) return { t: T.yoursToDecide(kind), c: "#4ade80" };
	if (n.owner === "third")
		return { t: T.waitsFor(kind, n.waits || T.someone), c: n.overdue ? "#fbbf24" : "#a1a1aa" };
	if (n.owner !== "agent") return { t: T.waitsFor(kind, `@${n.owner}`), c: "#a1a1aa" };
	if (n.unjudged) return { t: T.toBeJudged, c: "#d9e2ee" };
	const state = n.activity ? T.agentOnItShort : n.overdue ? T.revisitOverdue : T.followed;
	return { t: T.agentState(kind, state), c: n.overdue ? "#fbbf24" : "#d9e2ee" };
}
const matches = (n) =>
	(ui.own === "all" || groupOf(n) === ui.own) && (ui.kind === "all" || n.kind === ui.kind);

const span = (ms) => {
	const s = Math.round(Math.abs(ms) / 1000);
	if (s < 90) return `${s} s`;
	if (s < 5400) return `${Math.round(s / 60)} min`;
	if (s < 172800) return `${Math.round(s / 3600)} h`;
	return `${Math.round(s / 86400)} d`;
};
const ago = (iso) => (iso ? T.ago(span(Date.now() - Date.parse(iso))) : T.never);
const until = (iso) => {
	const ms = Date.parse(iso) - Date.now();
	return ms >= 0 ? T.in(span(ms)) : T.ago(span(ms));
};
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const elapsed = (iso) => {
	const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

let toastTimer = null;
function toast(text, error = false) {
	const el = $("toast");
	el.innerHTML = `${error ? "" : CHECK}<span>${esc(text)}</span>`;
	el.classList.toggle("error", error);
	el.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		el.hidden = true;
	}, 4500);
}
let drawerOpen = false;
let focusId = null;

// ── Sending actions to the server ─────────────────────────────────────────────────────────────
async function post(url, body) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", "x-rusuban": "1" },
		body: JSON.stringify(body ?? {}),
	});
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
	return res.json().catch(() => ({}));
}

// ── Graph ─────────────────────────────────────────────────────────────────────────────────────
const gatesHtml = (gates) =>
	`<span class="gates">${gates.map((g) => `<i style="background:${GATE[g.state]}" title="${esc(`${g.name}: ${g.detail}`)}"></i>`).join("")}</span>`;

// Read-only for now: answering a card comes with the inbox. Who speaks stays clear: what the agent
// did, then the question to its person, then the options, each with what the agent will do.
function decisionHtml(n) {
	const d = n.decision;
	const rec = d.options.find((o) => o.id === d.rec);
	const answer = answerOf(n);
	const opts = d.options
		.map(
			(o) =>
				`<li class="opt${o.id === d.rec ? " rec-opt" : ""}"><b>“${esc(o.label)}”</b><span>→ ${esc(o.effect)}</span>${o.message ? `<small class="msg">${T.githubMessage} ${esc(o.message)}</small>` : ""}</li>`,
		)
		.join("");
	return `<section class="decision${answer ? " answered" : ""}" aria-label="${T.decision}">
		${d.done ? `<div class="said agent"><span class="who">${CRAB}${T.agentDid}</span><p>${esc(d.done)}</p></div>` : ""}
		<div class="said you"><span class="who">${d.to === S.me ? T.yourDecision : esc(T.decisionFor(d.to))}</span><h3>${esc(d.q)}</h3><p class="ctx">${esc(d.ctx)}</p></div>
		${rec ? `<div class="rec"><small>${CRAB}${T.agentRecommends}</small><b>“${esc(rec.label)}”</b><span>${esc(d.why ?? "")}</span></div>` : ""}
		${answer ? `<div class="done-box" role="status">${CHECK}<div><b>${esc(T.answerRecorded(answer))}</b><span><span class="dot pulse"></span>${T.agentApplies}</span></div></div>` : ""}
		<h4 class="pick">${T.options}</h4>
		<ul class="opts">${opts}</ul>
	</section>`;
}

const settledHtml = (s) => `<section class="decision settled" aria-label="${T.decision}">
	<div class="done-box">${CHECK}<div><b>${esc(T.settledTitle(s.state, s.choice))}</b><span>${esc(s.outcome)}</span><small>${esc(ago(s.at))} · ${esc(s.q)}</small></div></div>
</section>`;

function detailHtml(n, linked) {
	const num = numOf(n.repo, n.n);
	const parts = [
		`<p class="gh">${esc(n.title)} · <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(T.onGitHub(num))}</a>${n.author ? ` · @${esc(n.author)}` : ""}</p>`,
	];
	if (n.observeOnly) parts.push(`<p class="note">${T.repoObserved}</p>`);
	if (n.activity)
		parts.push(
			`<div class="busy"><span class="dot pulse"></span><span>${esc(T.agentAtWork(n.activity))}</span></div>`,
		);
	if (n.decision) parts.push(decisionHtml(n));
	else if (n.settled) parts.push(settledHtml(n.settled));
	if (n.next) parts.push(`<div><h4>${T.next}</h4><p>${esc(n.next)}</p></div>`);
	if (n.block) parts.push(`<div><h4>${T.blockedBy}</h4><p>${esc(n.block)}</p></div>`);
	if (n.revisitAt && (n.owner === "agent" || n.owner === "third"))
		parts.push(
			`<div><h4>${T.backToAgents}</h4><p class="${n.overdue ? "late" : ""}">${esc(until(n.revisitAt))}</p></div>`,
		);
	if (n.type === "pr") {
		const sub = subOf(n);
		const status = n.eligible ? sub.t : n.owner === S.me ? T.afterYourAnswer : "";
		parts.push(`<div><div class="gatehead"><b>${T.mergeGates}</b><span style="color:${sub.c}">${esc(status)}</span></div>
			<ol class="gatelist">${n.gates.map((g) => `<li><i style="background:${GATE[g.state]}"></i><b>${esc(g.name)}</b><span>${esc(g.detail)}</span></li>`).join("")}</ol></div>`);
	}
	if (linked.length)
		parts.push(
			`<div><h4>${T.linkedTo}</h4><div class="links">${linked.map((l) => `<button type="button" data-focus="${esc(l.id)}">${l.type === "pr" ? T.pr : T.issue} ${esc(numOf(l.repo, l.n))} · ${esc(l.label)}</button>`).join("")}</div></div>`,
		);
	return `<div class="detail">${parts.join("")}</div>`;
}

function nodeHtml(n, ports, linked) {
	const color = kindColor(n);
	const exp = ui.exp.has(n.id);
	const sub = subOf(n);
	const cls = [
		"node",
		n.type,
		ownerClass(n),
		exp && "exp",
		!matches(n) && "dim",
		n.overdue && "overdue",
		focusId === n.id && "focus",
	]
		.filter(Boolean)
		.join(" ");
	const id = esc(n.id);
	// --kind colours the top edge, an inner shadow that follows the card's rounded corners.
	return `<div class="${cls}" style="left:${n.x}px;top:${n.y}px;--kind:${color}" data-id="${id}">
		${ports ? '<span class="port l"></span><span class="port r"></span>' : ""}
		${crab(n)}
		<div class="row top" data-toggle="${id}">${typeTag(n.type, color)}${ghLink(n)}<span class="own">${esc(ownLabel(n))}</span></div>
		<button type="button" class="head" data-toggle="${id}" aria-expanded="${exp}" aria-label="${esc(`${numOf(n.repo, n.n)} ${n.label}, ${exp ? T.fold : T.unfold}`)}">
			<span class="title" title="${esc(n.label)}">${esc(n.label)}</span>
			<span class="row">${n.type === "pr" ? gatesHtml(n.gates) : ""}<span class="sub" style="color:${sub.c}" title="${esc(sub.t)}">${esc(sub.t)}</span></span>
		</button>
		${exp ? detailHtml(n, linked) : ""}
	</div>`;
}

function curve(sx, sy, tx, ty) {
	const dx = Math.max(60, Math.abs(tx - sx) / 2);
	return {
		d: `M${sx} ${sy}C${sx + dx} ${sy},${tx - dx} ${ty},${tx} ${ty}`,
		mx: (sx + tx) / 2,
		my: (sy + ty) / 2,
	};
}
const head = (x, y) => `M${x - 9} ${y - 5}L${x} ${y}L${x - 9} ${y + 5}Z`;

let graphKey = "";
function renderGraph() {
	const M = S.model;
	const byId = new Map(M.nodes.map((n) => [n.id, n]));
	const neighbours = new Map();
	const link = (a, b) => {
		if (!neighbours.has(a)) neighbours.set(a, []);
		neighbours.get(a).push(byId.get(b));
	};
	for (const e of M.edges) {
		if (e.to === "main") continue;
		link(e.from, e.to);
		link(e.to, e.from);
	}
	const key = JSON.stringify([
		M.nodes.map((n) => ({ ...n, activity: n.activity?.name ?? null })),
		M.edges,
		M.frames,
		M.main,
		S.armed,
		S.me,
		S.project?.repos,
		ui.own,
		ui.kind,
		ui.themes,
		[...ui.exp],
		focusId,
	]);
	if (key === graphKey) return;
	graphKey = key;

	$("frames").innerHTML = M.frames
		.filter((f) => ui.themes || f.kind === "group")
		.map(
			(f) =>
				`<div class="frame ${f.kind === "group" ? f.group : ""}" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px"><span>${esc(f.kind === "group" ? T.groupFrame(f.group, f.count) : f.theme || T.noArea)}</span></div>`,
		)
		.join("");
	const toMain = new Set(M.edges.filter((e) => e.to === "main").map((e) => e.from));
	$("nodes").innerHTML = M.nodes
		.map((n) => nodeHtml(n, neighbours.has(n.id) || toMain.has(n.id), neighbours.get(n.id) ?? []))
		.join("");

	const paths = [];
	const labels = [];
	for (const e of M.edges) {
		const a = byId.get(e.from);
		const dim = !matches(a) || (e.to !== "main" && !matches(byId.get(e.to)));
		const op = dim ? 0.12 : 1;
		// "Same files" stays quiet; it lights up with its label when one of its nodes is hovered or open.
		const hot = e.kind === "files" && (ui.exp.has(e.from) || ui.exp.has(e.to)) ? " hot" : "";
		const ends = `data-a="${esc(e.from)}" data-b="${esc(e.to)}"`;
		let c;
		if (e.to === "main") {
			c = curve(a.x + W, a.y + PY, M.main.x - 7, M.main.y + 48);
			paths.push(`<path class="main${e.live ? " live" : ""}" d="${c.d}" opacity="${op}"/>`);
			if (e.live)
				paths.push(
					`<path class="head" d="${head(M.main.x - 7, M.main.y + 48)}" fill="#34b27b" opacity="${op}"/>`,
				);
		} else {
			const b = byId.get(e.to);
			if (e.kind === "files" && Math.abs(a.x - b.x) < 10) {
				const x = a.x + W;
				c = {
					d: `M${x} ${a.y + PY}C${x + 90} ${a.y + PY},${x + 90} ${b.y + PY},${x} ${b.y + PY}`,
					mx: x + 68,
					my: (a.y + b.y) / 2 + PY,
				};
			} else if (e.kind === "files") {
				const [l, r] = a.x < b.x ? [a, b] : [b, a];
				c = curve(l.x + W, l.y + PY, r.x, r.y + PY);
			} else c = curve(a.x + W, a.y + PY, b.x - 1, b.y + PY);
			paths.push(`<path class="${e.kind}${hot}" ${ends} d="${c.d}" opacity="${op}"/>`);
			if (e.kind === "addresses" || e.kind === "before")
				paths.push(
					`<path class="head" d="${head(b.x - 1, b.y + PY)}" fill="${e.kind === "before" ? "#e4e4e7" : "rgba(255,255,255,0.45)"}" opacity="${op}"/>`,
				);
		}
		if (e.label)
			labels.push(
				`<span class="elabel ${e.kind}${hot}" ${ends} style="left:${c.mx}px;top:${c.my}px;opacity:${op}">${esc(e.label)}</span>`,
			);
	}
	$("edges").innerHTML = paths.join("");
	$("labels").innerHTML = labels.join("");
	// One node gathers the merges of every repo: it bears the branch name when all repos share it.
	const branches = [
		...new Set(
			Object.values(S.rules ?? {})
				.map((r) => r?.ref)
				.filter(Boolean),
		),
	];
	$("main-node").innerHTML =
		`<div class="main-card" style="left:${M.main.x}px;top:${M.main.y}px"><span class="port"></span><b>${esc(branches.length === 1 ? branches[0] : T.mainTitle)}</b>
		<span>${esc(T.mainFlow(M.main.inFlight, M.main.ready))}</span>
		<small>${esc(T.mainMerged(M.main.merged7, M.main.mergedAuto))}</small></div>`;
	renderMinimap();
}

function bounds() {
	const M = S.model;
	const xs = [
		M.main.x,
		M.main.x + 260,
		...M.frames.flatMap((f) => [f.x, f.x + f.w]),
		...M.nodes.flatMap((n) => [n.x, n.x + W]),
	];
	const ys = [
		M.main.y,
		M.main.y + 100,
		...M.frames.flatMap((f) => [f.y, f.y + f.h]),
		...M.nodes.flatMap((n) => [n.y, n.y + 76]),
	];
	const x = Math.min(...xs) - 40;
	const y = Math.min(...ys) - 40;
	return { x, y, w: Math.max(...xs) + 40 - x, h: Math.max(...ys) + 40 - y };
}

const MINI_COLOR = { mine: "#34b27b", agent: "#e4e4e7", others: "rgba(255,255,255,0.28)" };
function renderMinimap() {
	const b = bounds();
	const s = Math.min(206 / b.w, 150 / b.h);
	const dots = S.model.nodes.map(
		(n) =>
			`<i style="left:${(n.x - b.x) * s}px;top:${(n.y - b.y) * s}px;width:${W * s}px;height:${76 * s}px;background:${MINI_COLOR[groupOf(n)]}"></i>`,
	);
	dots.push(
		`<i style="left:${(S.model.main.x - b.x) * s}px;top:${(S.model.main.y - b.y) * s}px;width:${260 * s}px;height:${96 * s}px;background:#34b27b"></i>`,
	);
	$("mini").innerHTML = dots.join("");
	renderMiniView();
}

function renderMiniView() {
	if (!S) return;
	const b = bounds();
	const s = Math.min(206 / b.w, 150 / b.h);
	const vp = $("vp");
	Object.assign($("mini-view").style, {
		left: `${4 + (-ui.px / ui.z - b.x) * s}px`,
		top: `${4 + (-ui.py / ui.z - b.y) * s}px`,
		width: `${(vp.clientWidth / ui.z) * s}px`,
		height: `${(vp.clientHeight / ui.z) * s}px`,
	});
}

function applyTransform() {
	$("world").style.transform = `translate(${ui.px}px, ${ui.py}px) scale(${ui.z})`;
	$("world").classList.toggle("compact", ui.z < 0.75);
	const g = 24 * ui.z;
	Object.assign($("vp").style, {
		backgroundSize: `${g}px ${g}px`,
		backgroundPosition: `${ui.px}px ${ui.py}px`,
	});
	$("zoom-pct").textContent = `${Math.round(ui.z * 100)} %`;
	renderMiniView();
}

function zoomAt(f, mx, my) {
	const z = Math.min(1.6, Math.max(0.1, ui.z * f));
	ui.px = mx - ((mx - ui.px) * z) / ui.z;
	ui.py = my - ((my - ui.py) * z) / ui.z;
	ui.z = z;
	applyTransform();
	save();
}

function fit() {
	if (!S) return false;
	const b = bounds();
	const vp = $("vp");
	// Hidden or not laid out yet: fit at the next render.
	if (!vp.clientWidth || !vp.clientHeight) return false;
	// The minimap, when shown, holds the bottom right corner: the graph fits in the room left of it.
	const w = Math.max(200, vp.clientWidth - ($("minimap").offsetWidth ? 200 : 0));
	const h = vp.clientHeight;
	ui.z = Math.min(1, Math.max(0.1, Math.min(w / b.w, h / b.h)));
	ui.px = (w - b.w * ui.z) / 2 - b.x * ui.z;
	ui.py = (h - b.h * ui.z) / 2 - b.y * ui.z;
	applyTransform();
	save();
	return true;
}

function focusOn(id) {
	const node = S.model.nodes.find((x) => x.id === id);
	if (!node) return;
	ui.view = "graph";
	ui.exp.add(id);
	focusId = id;
	ui.z = Math.max(ui.z, 1);
	render(); // show the graph first: from the kanban it is hidden and measures nothing
	const vp = $("vp");
	ui.px = vp.clientWidth / 2 - (node.x + 160) * ui.z;
	ui.py = vp.clientHeight * 0.3 - (node.y + 38) * ui.z;
	applyTransform();
	save();
	setTimeout(() => {
		focusId = null;
		render();
	}, 1600);
}

// ── Kanban ────────────────────────────────────────────────────────────────────────────────────
function cardHtml(n) {
	const color = kindColor(n);
	const sub = subOf(n);
	return `<div class="card ${ownerClass(n)}${n.activity ? " working" : ""}">
		${crab(n)}
		<span class="row">${typeTag(n.type, color)}${ghLink(n)}${n.type === "pr" ? gatesHtml(n.gates) : ""}</span>
		<button type="button" class="card-open" data-focus="${esc(n.id)}" title="${T.seeInGraph}">
			<b>${esc(n.label)}</b>
			<span class="sub">${esc(n.decision && !n.decision.answer ? n.decision.q : n.next || sub.t)}</span>
		</button>
	</div>`;
}

function renderKanban() {
	const M = S.model;
	const rank = (n) => (n.decision ? 0 : 1) * 10 + (n.priority ? Number(n.priority.slice(1)) : 4);
	const col = (group) => {
		const list = M.nodes
			.filter((n) => groupOf(n) === group && matches(n))
			.sort((a, b) => rank(a) - rank(b) || b.n - a.n);
		return `<section class="col ${group}"><h2>${T.groups[group]}<span class="mono">${list.length}</span></h2>${list.map(cardHtml).join("")}</section>`;
	};
	const merged = M.merged
		.map(
			(m) =>
				`<a class="card" href="${esc(m.url)}" target="_blank" rel="noopener"><span class="row">${typeTag("pr", "#a1a1aa")}<span class="num">${esc(numOf(m.repo, m.n))}</span>${m.auto ? `<span class="auto">${T.auto}</span>` : ""}</span><b>${esc(m.title)}</b><span class="sub">${esc(T.mergedAgo(ago(m.mergedAt), m.author))}</span></a>`,
		)
		.join("");
	$("kanban").innerHTML =
		`${col("mine")}${col("agent")}${col("others")}<section class="col"><h2>${T.merged7}<span class="mono">${M.merged.length}</span></h2>${merged}</section>`;
}

// ── Header, footer, drawer ────────────────────────────────────────────────────────────────────
const runName = (r) =>
	`${r.title || r.kind}${r.items?.length ? ` · ${r.items.map(numOfKey).join(", ")}` : ""}`;

function agentsNow() {
	const runs = S.runs ?? [];
	const running = runs.filter((r) => r.state === "running");
	if (running.length === 1)
		return {
			label: `${runName(running[0])} · ${running[0].step || T.starting}`,
			since: running[0].startedAt,
			busy: true,
		};
	if (running.length > 1) {
		const since = running.map((r) => r.startedAt).sort()[0];
		return {
			label: T.runningCount(running.length, running.map((r) => r.title || r.kind).join(", ")),
			since,
			busy: true,
		};
	}
	if (runs.some((r) => r.state === "queued")) return { label: T.queued, since: null, busy: true };
	const last = runs.filter((r) => r.endedAt).sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
	return { label: last ? T.idleSince(ago(last.endedAt)) : T.idle, since: null, busy: false };
}

function tick() {
	if (!S) return;
	const f = S.freshness ?? {};
	const age = f.checkedAt
		? (Date.now() - Date.parse(f.checkedAt)) / 1000
		: Number.POSITIVE_INFINITY;
	// Stale past three refresh periods (FR-072).
	const stale = age > ((f.intervalMs ?? 90_000) / 1000) * 3;
	const dot = $("fresh").querySelector(".dot");
	dot.style.background = f.error ? "#ef4444" : stale ? "#f59e0b" : "#34b27b";
	dot.classList.toggle("pulse", !!f.refreshing);
	let label = T.notReadYet;
	if (f.refreshing) label = T.reading;
	else if (f.error) label = T.readError(ago(f.checkedAt), f.error);
	else if (f.checkedAt) label = T.readAgo(ago(f.checkedAt));
	$("fresh-label").textContent = stale && f.checkedAt && !f.refreshing ? T.stale(label) : label;
	const a = agentsNow();
	$("agents-label").textContent = a.label;
	$("agents-time").textContent = a.since ? elapsed(a.since) : "";
	$("agents").classList.toggle("busy", a.busy);
}

const lockValue = (k, v) =>
	k === "evidence"
		? v.map((e) => `${e.paths.join(", ")} → ${e.what}`).join("; ")
		: Array.isArray(v)
			? v.join(", ")
			: String(v);

function rulesHtml() {
	const parts = (S.project?.repos ?? []).map((slug) => {
		const r = S.rules?.[slug];
		const f = S.freshness?.repos?.[slug];
		const read = f?.checkedAt ? T.readAgo(ago(f.checkedAt)) : T.notReadYet;
		const old =
			f?.checkedAt &&
			Date.now() - Date.parse(f.checkedAt) > (S.freshness?.intervalMs ?? 90_000) * 3;
		const header = `<header><b class="mono">${esc(slug)}</b><span class="mono">${esc(old ? T.stale(read) : read)}</span></header>`;
		const failed = f?.error ? `<p class="err">${esc(T.githubError(f.error))}</p>` : "";
		if (!r) return `<div class="act">${header}${failed}<p>${T.rulesNotLoaded}</p></div>`;
		const state = r.observeOnly
			? `<p class="warn">${T.repoObserveOnly}</p>`
			: `<p>${esc(T.rulesFiles(r.files ?? []))}${r.treeSha ? ` <span class="mono">@${esc(r.treeSha.slice(0, 7))}</span>` : ""}</p>`;
		const locks = r.locks
			? `<ul class="rules">${Object.entries(r.locks)
					.map(
						([k, v]) =>
							`<li><b>${esc(T.lockNames[k] ?? k)}</b> <span class="mono">${esc(lockValue(k, v))}</span></li>`,
					)
					.join("")}</ul>`
			: "";
		const errors = (r.errors ?? []).map((e) => `<p class="err">${esc(e)}</p>`).join("");
		return `<div class="act">${header}${failed}${state}${locks}${errors}</div>`;
	});
	parts.push(
		`<div class="act"><header><b>${T.builtInLocks}</b></header><ul class="rules">${T.builtIn.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`,
	);
	return parts.join("");
}

function renderDrawer() {
	const el = $("drawer");
	el.hidden = !drawerOpen;
	$("agents").setAttribute("aria-expanded", String(drawerOpen));
	if (!drawerOpen) return;
	const runs = S.runs ?? [];
	const live = runs.filter((r) => r.state === "running" || r.state === "queued");
	const recent = runs
		.filter((r) => r.state !== "running" && r.state !== "queued" && r.summary)
		.slice(0, 10);
	const liveHtml = live.length
		? live
				.map(
					(r) =>
						`<div class="act"><header><span class="dot pulse"></span><b>${esc(runName(r))}</b><span class="mono">${r.state === "running" && r.startedAt ? elapsed(r.startedAt) : ""}</span></header><p>${esc(r.state === "queued" ? T.queued : r.step || "…")}</p></div>`,
				)
				.join("")
		: `<p class="act">${T.idleLong}</p>`;
	const recentHtml =
		recent
			.map(
				(r) =>
					`<div class="act"><header><b>${esc(runName(r))}</b><span class="state ${esc(r.state)}">${esc(T.runState[r.state] ?? r.state)}</span><span class="mono">${r.state === "limited" && r.retryAt ? esc(T.limitedUntil(clock(r.retryAt))) : r.endedAt ? clock(r.endedAt) : ""}</span></header><p>${esc(r.summary)}</p></div>`,
			)
			.join("") || `<p class="act">${T.none}</p>`;
	const journalHtml =
		(S.journal ?? [])
			.map(
				(j) =>
					`<li${j.notify ? ' class="flag"' : ""}><span class="mono">${clock(j.at)}</span><span>${j.item ? `<button type="button" class="secondary small" data-focus="${esc(j.item)}">${esc(numOfKey(j.item))}</button> ` : ""}${esc(j.text)}${j.href ? ` <a href="${esc(j.href)}" target="_blank" rel="noopener">↗</a>` : ""}</span></li>`,
			)
			.join("") || `<li class="empty">${T.emptyJournal}</li>`;
	el.innerHTML = `
		<h2>${T.agentsNow} <button type="button" class="secondary" data-close>${T.close}</button></h2>
		<section>${liveHtml}</section>
		<section><h2>${T.recentRuns}</h2>${recentHtml}</section>
		<section><h2>${T.journal}</h2><ul class="journal">${journalHtml}</ul></section>
		<section><h2>${T.rulesAndLocks}</h2>${rulesHtml()}</section>`;
}

// One project: its name. Several: a switcher (a switcher with one choice would do nothing).
let projectsKey = "";
function renderProjects() {
	const list = S.projects ?? [];
	const select = $("project");
	select.hidden = list.length < 2;
	$("project-name").hidden = list.length !== 1;
	$("project-name").textContent = S.project?.title ?? "";
	const key = JSON.stringify(list);
	if (key !== projectsKey) {
		projectsKey = key;
		select.innerHTML = list
			.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`)
			.join("");
	}
	if (S.project) select.value = S.project.id;
}

function render() {
	if (!S) return;
	const M = S.model;
	renderProjects();
	$("mine-count").textContent = M.counts.mine;
	$("mine").setAttribute("aria-pressed", String(ui.own === "mine"));
	$("auto").setAttribute("aria-checked", String(S.armed));
	$("paused").hidden = S.armed;
	$("observe").hidden = !S.project?.observeOnly;
	$("dry").hidden = !S.dry;
	$("shadow").hidden = S.project?.mode !== "shadow";
	for (const b of document.querySelectorAll(".tabs button"))
		b.setAttribute("aria-selected", String(b.dataset.view === ui.view));
	$("vp").hidden = ui.view !== "graph";
	$("kanban").hidden = ui.view !== "kanban";
	$("themes").setAttribute("aria-pressed", String(ui.themes));
	$("own-chips").innerHTML = ["all", "mine", "agent", "others"]
		.map(
			(id) =>
				`<button type="button" class="chip" data-own="${id}" aria-pressed="${ui.own === id}">${T.groups[id]}<span class="mono">${M.counts[id]}</span></button>`,
		)
		.join("");
	// The kinds present, and the one selected even when it is gone, so it can be cleared.
	const kinds = Object.keys(T.kinds).filter(
		(k) => k === ui.kind || M.nodes.some((n) => n.kind === k),
	);
	$("kind-chips").innerHTML = [
		["all", T.allKinds, ""],
		...kinds.map((k) => [k, T.kinds[k], KIND_COLOR[k]]),
	]
		.map(
			([id, l, c]) =>
				`<button type="button" class="chip" data-kind="${id}" aria-pressed="${ui.kind === id}">${c ? `<i style="background:${c}"></i>` : ""}${l}</button>`,
		)
		.join("");
	$("feed").innerHTML = (S.journal ?? [])
		.filter((j) => j.by !== S.me && j.by !== "owner")
		.slice(0, 3)
		.map((j) => `<span><span class="mono">${clock(j.at)}</span>${esc(j.text)}</span>`)
		.join("");
	if (ui.view === "graph") {
		renderGraph();
		if (!ui.fitted) ui.fitted = fit();
		applyTransform();
	} else renderKanban();
	renderDrawer();
	tick();
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────
const vp = $("vp");
vp.addEventListener(
	"wheel",
	(e) => {
		e.preventDefault();
		const r = vp.getBoundingClientRect();
		zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
	},
	{ passive: false },
);
// Panning: drag from anywhere, a node included, but a field, a link or the stage's controls. The
// pointer is captured only once the move starts, so a plain click on a node always opens it; and
// the click that ends a drag is swallowed, so a drag opens nothing.
const NO_PAN = "input, textarea, select, a, summary, .detail button, .zoom, .minimap";
let drag = null;
let swallowClick = false;
let frame = 0;
vp.addEventListener("pointerdown", (e) => {
	if (e.button !== 0 || e.target.closest(NO_PAN)) return;
	drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: ui.px, py: ui.py, moved: false };
});
vp.addEventListener("pointermove", (e) => {
	if (!drag || e.pointerId !== drag.id) return;
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	if (!drag.moved) {
		if (Math.hypot(dx, dy) < 4) return;
		drag.moved = true;
		vp.setPointerCapture(e.pointerId);
		vp.classList.add("dragging");
	}
	ui.px = drag.px + dx;
	ui.py = drag.py + dy;
	// One update per frame, however many events.
	if (!frame)
		frame = requestAnimationFrame(() => {
			frame = 0;
			applyTransform();
		});
});
const endDrag = (e) => {
	if (!drag || (e && e.pointerId !== drag.id)) return;
	if (drag.moved) {
		swallowClick = true;
		setTimeout(() => {
			swallowClick = false;
		}, 0);
		save();
	}
	drag = null;
	vp.classList.remove("dragging");
};
vp.addEventListener("pointerup", endDrag);
vp.addEventListener("pointercancel", endDrag);
vp.addEventListener("lostpointercapture", endDrag);
// Hovering a node lights its "same files" links, without rebuilding the graph.
let hovered = null;
const lightFiles = (id, on) => {
	const v = CSS.escape(id);
	for (const el of document.querySelectorAll(
		`#edges .files[data-a="${v}"], #edges .files[data-b="${v}"], #labels .files[data-a="${v}"], #labels .files[data-b="${v}"]`,
	))
		if (!ui.exp.has(el.dataset.a) && !ui.exp.has(el.dataset.b)) el.classList.toggle("hot", on);
};
$("nodes").addEventListener("mouseover", (e) => {
	const id = e.target.closest(".node")?.dataset.id ?? null;
	if (id === hovered || drag?.moved) return;
	if (hovered) lightFiles(hovered, false);
	hovered = id;
	if (id) lightFiles(id, true);
});
$("nodes").addEventListener("mouseleave", () => {
	if (hovered) lightFiles(hovered, false);
	hovered = null;
});
// Native drag and drop (text, link, image) stole the pointer: "forbidden" cursor, move cut short.
vp.addEventListener("dragstart", (e) => e.preventDefault());
vp.addEventListener(
	"click",
	(e) => {
		if (!swallowClick) return;
		swallowClick = false;
		e.stopPropagation();
		e.preventDefault();
	},
	true,
);
$("minimap").addEventListener("click", (e) => {
	if (!S) return;
	const b = bounds();
	const s = Math.min(206 / b.w, 150 / b.h);
	const r = $("mini").getBoundingClientRect();
	const wx = (e.clientX - r.left) / s + b.x;
	const wy = (e.clientY - r.top) / s + b.y;
	ui.px = vp.clientWidth / 2 - wx * ui.z;
	ui.py = vp.clientHeight / 2 - wy * ui.z;
	applyTransform();
	save();
});
$("zoom-in").onclick = () => zoomAt(1.25, vp.clientWidth / 2, vp.clientHeight / 2);
$("zoom-out").onclick = () => zoomAt(1 / 1.25, vp.clientWidth / 2, vp.clientHeight / 2);
$("fit").onclick = fit;
$("collapse").onclick = () => {
	ui.exp.clear();
	save();
	render();
};
$("themes").onclick = () => {
	ui.themes = !ui.themes;
	save();
	render();
};
$("mine").onclick = () => {
	ui.own = ui.own === "mine" ? "all" : "mine";
	save();
	render();
};
$("auto").onclick = async () => {
	try {
		S.armed = (await post("/api/automerge", { armed: !S.armed })).armed;
		render();
	} catch (err) {
		toast(T.switchFailed(err.message), true);
	}
};
$("fresh").onclick = () =>
	post("/api/refresh", { project: ui.project }).catch((err) =>
		toast(T.refreshFailed(err.message), true),
	);
$("agents").onclick = () => {
	drawerOpen = !drawerOpen;
	renderDrawer();
};
$("feed-open").onclick = () => {
	drawerOpen = true;
	renderDrawer();
};
$("project").addEventListener("change", (e) => {
	ui.project = e.target.value;
	ui.fitted = false;
	graphKey = "";
	save();
	connect();
});

document.addEventListener("click", (e) => {
	if (e.target.closest("a[href]")) return;
	const t = e.target.closest(
		"[data-toggle],[data-focus],[data-own],[data-kind],[data-view],[data-close]",
	);
	if (!t) return;
	if (t.dataset.toggle) {
		const id = t.dataset.toggle;
		if (ui.exp.has(id)) ui.exp.delete(id);
		else ui.exp.add(id);
	} else if (t.dataset.focus) return focusOn(t.dataset.focus);
	else if (t.dataset.own) ui.own = t.dataset.own;
	else if (t.dataset.kind) ui.kind = t.dataset.kind;
	else if (t.dataset.view) ui.view = t.dataset.view;
	else if (t.dataset.close !== undefined) drawerOpen = false;
	$("collapse").hidden = !ui.exp.size;
	save();
	render();
});
window.addEventListener("resize", () => (ui.fitted ? renderMiniView() : render()));

// ── Live stream, one project at a time ────────────────────────────────────────────────────────
let es = null;
function connect() {
	es?.close();
	es = new EventSource(
		`/api/events${ui.project ? `?project=${encodeURIComponent(ui.project)}` : ""}`,
	);
	es.addEventListener("state", (ev) => {
		S = JSON.parse(ev.data);
		// The server picks the first project when none or an unknown one was asked for.
		if (S.project && S.project.id !== ui.project) {
			ui.project = S.project.id;
			save();
		}
		$("offline").hidden = true;
		$("collapse").hidden = !ui.exp.size;
		render();
	});
	es.onerror = () => {
		$("offline").hidden = false;
	};
}
connect();
setInterval(tick, 1000);
applyTransform();
