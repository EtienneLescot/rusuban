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
	journalAndRules: "Journal and rules",
	autoMerge: "Auto-merge",
	forYou: "for you",
	view: "View",
	graph: "Graph",
	kanban: "Kanban",
	paused: "Auto-merge is paused: no PR is merged without you.",
	observeTitle: "Observe only",
	observeText: (branch) =>
		`No rules in <span class="mono">.rusuban/rules/</span> on ${branch ? esc(branch) : "the default branch"}: agents read this project and never act.`,
	dry: "Dry mode: the server starts no agent and writes nothing on GitHub.",
	noModel: "No model is set for the runs, so none starts: rusuban model <id> sets one.",
	modelAsked: (m) => `Not the model asked for, ${m}`,
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
	peopleMerge: "people merge",
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
	close: "Close",
	recentRuns: "Recent runs",
	none: "None.",
	journal: "Journal",
	emptyJournal: "Empty for now.",
	// The Agents view
	runningNow: "Running now",
	nothingRunning: "Nothing runs now.",
	recurringTasks: "Recurring tasks",
	noTasks: "No recurring task.",
	colTask: "Task",
	colSchedule: "Schedule",
	colNext: "Next",
	colLastRun: "Last run",
	onClick: "on a click",
	lockOf: (lock) => `lock ${lock}`,
	neverRun: "never run",
	runNow: "Run now",
	taskStarted: (title) => `${title} started`,
	runRefused: (error) => `Run refused: ${error}`,
	prompt: "Prompt",
	openTaskFile: "Open the task file",
	lastRuns: "Last runs",
	today: "today",
	yesterday: "yesterday",
	tomorrow: "tomorrow",
	runKinds: { judge: "Judge", act: "Coordinator", worker: "Worker", task: "Task" },
	runState: {
		running: "running",
		queued: "queued",
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
	// The inbox and its cards
	inbox: "Inbox",
	conversations: "Conversations",
	indexedAgo: (n, age) => `${n} · indexed ${age} ago`,
	notIndexed: "not indexed yet",
	startedFrom: "Started from",
	origins: { all: "All", desktop: "Desktop", terminal: "Terminal", rusuban: "Rusuban" },
	notLinked: "Not linked to an item",
	forkOf: (time) => `Fork: your answer of ${time}`,
	convStates: { live: "live", running: "running", done: "done", ended: "ended", failed: "failed" },
	liveIn: {
		desktop: "Live in Claude Desktop",
		terminal: "Live in a terminal",
		rusuban: "At work in Rusuban",
	},
	endedAgo: (age) => `Ended ${age} ago`,
	startedAt: (time) => `started ${time}`,
	earlier: "Earlier messages",
	answer: "Answer",
	answerInFork: "Answer in a fork",
	openInTerminal: "Open in terminal",
	openedInTerminal: "Opened in a terminal",
	replied: (forked) => (forked ? "Answered in a fork" : "Answer sent"),
	pickConversation: "Pick a conversation to read it here.",
	noConversations: "No conversation found in the project's folders yet.",
	menu: "Menu",
	forYouTitle: "For you",
	allProjects: "all projects",
	nothingForYou: "Nothing waits for you.",
	// The inbox's two queues (FR-099): the items' decisions, and how the agents follow the projects.
	decisions: "Decisions",
	rulesQueue: "Rules & settings",
	nothingInRules: "No question on the rules or the settings.",
	about: { proposal: "Rule proposal", rule: "Silent rule", lock: "Lock", setting: "Setting" },
	cardsCount: (n) => plural(n, "card"),
	ruleAddedTo: "Added to",
	seenOn: "Seen on",
	ownWordsRule: "Or change the rule in your own words",
	// A request about an item, from its card: it goes to the coordinator.
	askAbout: "Ask Claude about this item",
	askSent: "Sent to the coordinator",
	askFailed: (error) => `Not sent: ${error}`,
	rulesPrs: "Rules PRs",
	rulesPr: "Rules PR",
	rulesPrCi: {
		success: "CI green",
		failure: "CI red",
		pending: "CI running",
		action_required: "CI waits for approval",
		none: "no CI",
	},
	mergedByAPerson: "A person merges it on GitHub",
	digest: "digest",
	forYouUrgency: (urgency) => `for you · ${urgency}`,
	byAuthor: (login) => `by @${login}`,
	gitHubLink: "GitHub",
	conversationCount: (n) => plural(n, "conversation"),
	whatIDid: "What I did",
	whatIDidCount: (n) => `What I did · ${plural(n, "conversation")}`,
	judgedIn: "Judged in this run.",
	conversation: "Conversation",
	link: "Link",
	proof: "Proof",
	proofState: (state) => `A worker's proof on the head: ${state}.`,
	recommended: "Recommended",
	ownWords: "Or answer in your own words",
	ownWordsShort: "Or in your own words",
	send: "Send",
	sendOption: (label) => `Send “${label}”`,
	postsOnGitHub: "Posts on GitHub:",
	answeredCard: (label) => `Answered: “${label}”`,
	carriedOut: "The coordinator carries it out.",
	cardGone: "This card is closed: it was answered or replaced.",
	answerSent: "Answer sent",
	setting: "Setting",
	lease: "Machine",
	machines: "Machines",
	probed: (age) => `probed ${age} ago`,
	notProbed: "Not probed yet.",
	desktopOf: (login) => `${login}'s desktop`,
	machineFree: "Free.",
	machineFreeAsks: (login) => `Free · each lease asks ${login} first.`,
	machineOffline: (since, said) =>
		`Offline${since ? ` for ${since}` : ""}: ${String(said ?? "no answer").replace(/\.$/, "")}.`,
	heldBy: (run, ref, left, next) =>
		`Held by <b>${run}</b>${ref ? ` for ${ref}` : ""}, ${left} left.${next ? ` Next: <b>${next.run}</b>, waiting ${next.wait}.` : ""}`,
	leaseUnreadable: "Held, by a lease that cannot be read: Release frees it.",
	release: "Release",
	confirmRelease: "Release it?",
	released: (name) => `${name} released`,
	releaseFailed: (e) => `Not released: ${e}`,
	answerFailed: (error) => `Answer refused: ${error}`,
	flagged: "Flagged for you",
	issueRef: (n) => `Issue #${n}`,
	prRef: (n) => `PR #${n}`,
	stop: "Stop",
	confirmStop: "Stop it?",
	runStopped: "Run stopped",
	stopFailed: (error) => `Stop refused: ${error}`,
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
	view: "graph",
	origin: "all",
	// A phone opens on its inbox: the decisions waiting are what one checks from it.
	tab: "inbox",
	queue: "decisions", // the inbox's queue shown: "decisions", or "rules" for Rules & settings
	project: null,
	...saved,
	exp: new Set(saved?.exp ?? []),
	fitted: !!saved,
	card: null, // the card open in place of the inbox, from the address (#card/<id>)
};
if (!["graph", "kanban", "conversations", "agents"].includes(ui.view)) ui.view = "graph";
if (!["decisions", "rules"].includes(ui.queue)) ui.queue = "decisions";
const PHONE = matchMedia("(max-width: 720px)");
const phone = () => PHONE.matches;
if (!(ui.z >= 0.1 && ui.z <= 1.6)) Object.assign(ui, { z: 0.6, fitted: false });
const save = () => {
	try {
		const { card, ...kept } = ui;
		localStorage.setItem("rusuban.view", JSON.stringify({ ...kept, exp: [...ui.exp] }));
	} catch {}
};

let S = null; // the last state the server pushed
let INBOX = { cards: [], flags: [], rulesPrs: [] }; // the inbox the server pushed, every project's
let AGENTS = { dry: false, runs: [], tasks: [] }; // the project's runs and tasks, and the machines
let HUB = { indexedAt: null, conversations: [], items: {} }; // the project's Claude conversations
let READER = null; // the conversation open in the reader, a page of it
const picked = new Map(); // card id → the option picked on it, waiting for its Send
let stopArmed = null; // the run whose Stop was pressed once
let releaseArmed = null; // the machine whose Release was pressed once
let runFocus = null; // the runs the Agents view highlights: a run id, or an item's runs
const openTasks = new Set(); // the tasks unfolded in the Agents view

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
// A card waits for the owner: its node is outlined in amber, and says so.
const forYou = (n) => !!n.decision && !n.decision.answer && n.decision.to === S.me;
// The open card's entry in the inbox, and the item it is about.
const openCard = () => (ui.card ? (INBOX.cards.find((c) => c.card.id === ui.card) ?? null) : null);
const cardItem = () => openCard()?.item ?? null;

function subOf(n) {
	if (answerOf(n)) return { t: T.answerApplying, c: "#4ade80" };
	if (forYou(n)) return { t: T.forYou, c: "#fbbf24" };
	if (recentlySettled(n))
		return { t: n.settled.state === "replaced" ? T.cardReplaced : T.cardSettled, c: "#4ade80" };
	if (n.type === "pr") {
		if (n.owner === S.me) return { t: T.waitsForYou, c: "#4ade80" };
		if (n.eligible) return { t: T.readyNext, c: "#4ade80" };
		// The switch is a banner of its own: the line under a PR names what else stops it.
		const gates = n.gates.filter((g) => g.name !== "Switch");
		if (gates.every((g) => g.state === "ok" || g.state === "na"))
			return { t: T.readyPaused, c: "#fbbf24" };
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
// A time's day, the short way: today, yesterday, tomorrow, or its date.
const dayOf = (iso) => {
	const midnight = (t) => new Date(t).setHours(0, 0, 0, 0);
	const days = Math.round((midnight(iso) - midnight(Date.now())) / 86400e3);
	if (days === 0) return T.today;
	if (days === -1) return T.yesterday;
	if (days === 1) return T.tomorrow;
	return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
};
const when = (iso) => `${dayOf(iso)} ${clock(iso)}`;
// Today's times by the clock, older ones by their day.
const shortWhen = (iso) => (dayOf(iso) === T.today ? clock(iso) : dayOf(iso));

// Agents write Markdown. A summary shows as one paragraph: code, bold and italics kept, every other
// mark dropped, so no raw ** ever shows. The text is escaped first: only these tags come out.
const flat = (s) =>
	String(s ?? "")
		.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/gm, "")
		.replace(/\s*\n+\s*/g, " ")
		.trim();
const md = (s) =>
	esc(flat(s))
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<b>${a ?? b}</b>`)
		.replace(/\*\*|__/g, "")
		.replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?!\w)/g, "$1<i>$2</i>")
		.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1");
const plain = (s) => flat(s).replace(/\*\*|__|`/g, "");

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

// An item's open card as the inbox holds it, or as its node says when the inbox is not in yet.
const entryOf = (id) => {
	const c = INBOX.cards.find((x) => x.card.id === id);
	if (c) return c;
	const n = S?.model.nodes.find((x) => x.decision?.id === id);
	return n
		? {
				project: S.project.id,
				item: n.id,
				type: n.type,
				card: n.decision,
				answer: n.decision.answer,
			}
		: null;
};

// On an item's card, its open card answers as in the inbox (one block, answerHtml); without one,
// or once it is answered, a request to Claude about the item goes to the coordinator (FR-100).
function itemCardHtml(n) {
	const c = n.decision && entryOf(n.decision.id);
	const answer = c
		? `<section class="decision" aria-label="${T.decision}" data-answer="${esc(c.card.id)}">${answerHtml(c, true, `free:${n.id}`)}</section>`
		: "";
	if (c && !c.answer) return answer;
	const key = `ask:${n.id}`;
	return `${answer}<div class="ask" data-ask="${esc(n.id)}"><label for="${esc(key)}" class="cv-free-label">${T.askAbout}</label>
		<div class="cv-free"><textarea id="${esc(key)}" data-free="${esc(key)}" rows="2"></textarea><button type="button" class="send" data-send-ask="${esc(n.id)}" aria-label="${T.send}">${ARROW}</button></div></div>`;
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
	if (!n.decision && n.settled) parts.push(settledHtml(n.settled));
	parts.push(itemCardHtml(n));
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
	// The item's Claude conversations, by name then origin: a click opens one in Conversations.
	const convs = HUB.conversations.filter((c) => c.items.includes(n.id) && !c.forkOf);
	if (convs.length)
		parts.push(
			`<div><h4>${T.conversations}</h4><div class="links">${convs.map((c) => `<button type="button" data-conv="${esc(c.id)}">${esc(c.title)} · ${esc(T.origins[c.origin] ?? c.origin)}</button>`).join("")}</div></div>`,
		);
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
		forYou(n) && "for-you",
		cardItem() === n.id && "card-node",
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
		cardItem(),
		// An open item card shows its card as the inbox holds it, the option picked on it, and its
		// conversations, which come with their own event.
		INBOX.cards.filter((c) => ui.exp.has(c.item)),
		[...picked],
		HUB.conversations
			.filter((c) => c.items.some((i) => ui.exp.has(i)))
			.map((c) => [c.id, c.title, c.origin]),
	]);
	if (key === graphKey) return;
	graphKey = key;
	// An open card's node stays lit, the rest of the graph fades.
	$("world").classList.toggle("card-open", !!byId.get(cardItem()));

	$("frames").innerHTML = M.frames
		.filter((f) => ui.themes || f.kind === "group")
		.map(
			(f) =>
				`<div class="frame ${f.kind === "group" ? f.group : ""}" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px"><span>${esc(f.kind === "group" ? T.groupFrame(f.group, f.count) : f.theme || T.noArea)}</span></div>`,
		)
		.join("");
	const toMain = new Set(M.edges.filter((e) => e.to === "main").map((e) => e.from));
	keepTyping($("nodes"), () => {
		$("nodes").innerHTML = M.nodes
			.map((n) => nodeHtml(n, neighbours.has(n.id) || toMain.has(n.id), neighbours.get(n.id) ?? []))
			.join("");
	});

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
	// Without rules, only people merge (mockups/observe-only).
	const branch = branches.length === 1 ? branches[0] : (S.project?.defaultBranch ?? T.mainTitle);
	const flow = S.project?.observeOnly
		? `<span>${T.peopleMerge}</span>`
		: `<span>${esc(T.mainFlow(M.main.inFlight, M.main.ready))}</span>
		<small>${esc(T.mainMerged(M.main.merged7, M.main.mergedAuto))}</small>`;
	$("main-node").innerHTML =
		`<div class="main-card" style="left:${M.main.x}px;top:${M.main.y}px"><span class="port"></span><b>${esc(branch)}</b>
		${flow}</div>`;
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

// ── Inbox and cards ───────────────────────────────────────────────────────────────────────────
// Links that agents or GitHub wrote show only as web links: never a `javascript:` one.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? u : null);
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
// A setting and a desktop asked for are allowed or not, never answered in words.
const yesOrNo = (c) => c.type === "setting" || c.type === "lease";
const refOf = (c) => {
	if (c.type === "setting") return T.setting;
	if (c.type === "lease") return T.lease;
	const n = String(c.item).split("#")[1];
	return c.type === "pr" ? T.prRef(n) : T.issueRef(n);
};
const answerLabel = (c) =>
	c.answer ? (c.card.options.find((o) => o.id === c.answer.option)?.label ?? c.answer.note) : null;
const waiting = () => INBOX.cards.filter((c) => !c.answer);
// What is being typed survives a re-render: a free answer per card id, a request per `ask:<item>`;
// the field typed in gets the focus and the caret back.
const drafts = new Map();
function keepTyping(el, rebuild) {
	const a = document.activeElement;
	const typing = a?.dataset?.free && el.contains(a) ? a : null;
	const at = typing && [typing.dataset.free, typing.selectionStart, typing.selectionEnd];
	rebuild();
	for (const t of el.querySelectorAll("textarea[data-free]"))
		t.value = drafts.get(t.dataset.free) ?? "";
	if (!at) return;
	const t = [...el.querySelectorAll("textarea[data-free]")].find((x) => x.dataset.free === at[0]);
	t?.focus();
	t?.setSelectionRange(at[1], at[2]);
}

// The inbox's two queues (FR-099): a card asking how the agents follow a project (`about`) waits
// in Rules & settings, the items' own questions in Decisions.
const queueOf = (c) => (c.about ? "rules" : "decisions");
const ABOUT_COLOR = { proposal: "#a78bfa", rule: "#fbbf24", lock: "#f87171", setting: "#38bdf8" };
const aboutTag = (c) =>
	c.about
		? `<span class="tag" style="--tag:${ABOUT_COLOR[c.about]}">${esc(T.about[c.about])}</span>`
		: "";
// A setting's tag names it already; a rule proposal counts the cards it answers.
const queueRef = (c) =>
	c.type === "setting" ? "" : c.type === "rule" ? T.cardsCount(c.card.items.length) : refOf(c);

function inboxItemHtml(c) {
	const d = c.card;
	const now = d.urgency === "now";
	const current = d.id === ui.card;
	return `<button type="button" class="ibx-item${current ? " current" : ""}${c.answer ? " answered" : ""}" data-card="${esc(d.id)}"${current ? ' aria-current="true"' : ""}>
		<span class="ibx-meta"><i class="dot" style="background:var(${now ? "--amber" : "--grey"})"></i><span class="ibx-project">${esc(c.projectTitle)}</span>${aboutTag(c)}<span class="mono">${esc(queueRef(c))}</span><span class="grow"></span><span class="mono">${esc(now ? span(Date.now() - Date.parse(d.createdAt)) : T.digest)}</span></span>
		<span class="ibx-q">${esc(d.q)}</span>
		${c.answer ? `<span class="ibx-answered">${CHECK}${esc(T.answeredCard(answerLabel(c)))}</span>` : ""}
	</button>`;
}

// A PR that changes .rusuban/: a person merges it on GitHub, so it links there.
const CI_COLOR = { success: "--green", failure: "--red", action_required: "--amber" };
function rulesPrHtml(r) {
	return `<a class="ibx-item" href="${esc(safeUrl(r.url) ?? "#")}" target="_blank" rel="noopener">
		<span class="ibx-meta"><i class="dot" style="background:var(${CI_COLOR[r.ci] ?? "--grey"})"></i><span class="ibx-project">${esc(r.projectTitle)}</span><span class="tag" style="--tag:#34d399">${T.rulesPr}</span><span class="mono">${esc(T.prRef(r.item.split("#")[1]))}</span><span class="grow"></span><span class="mono">${esc(T.rulesPrCi[r.ci] ?? r.ci)}</span></span>
		<span class="ibx-q">${esc(r.title)}</span>
		<span class="ibx-sub">${T.mergedByAPerson} ↗</span>
	</a>`;
}

function inboxListHtml() {
	const rules = ui.queue === "rules";
	const head = phone()
		? `<div class="ibx-head"><h1>${T.forYouTitle}</h1><b class="mono amber">${waiting().length}</b></div>`
		: `<div class="ibx-head"><h1>${T.inbox}</h1><span>${T.allProjects}</span></div>`;
	const count = (q) => waiting().filter((c) => queueOf(c) === q).length;
	const tab = (q, label) =>
		`<button type="button" role="tab" data-queue="${q}" aria-selected="${ui.queue === q}">${label} <b class="mono${q === "rules" && count(q) ? " amber" : ""}">${count(q)}</b></button>`;
	const seg = `<div class="ibx-seg" role="tablist">${tab("decisions", T.decisions)}${tab("rules", T.rulesQueue)}</div>`;
	const shown = INBOX.cards.filter((c) => queueOf(c) === ui.queue);
	const list = shown.length
		? shown.map(inboxItemHtml).join("")
		: `<p class="ibx-empty">${rules ? T.nothingInRules : T.nothingForYou}</p>`;
	const prs =
		rules && INBOX.rulesPrs?.length
			? `<section class="ibx-flags"><h2>${T.rulesPrs}</h2></section><div class="ibx-list">${INBOX.rulesPrs.map(rulesPrHtml).join("")}</div>`
			: "";
	const flags =
		!rules && INBOX.flags.length
			? `<section class="ibx-flags"><h2>${T.flagged}</h2><ul>${INBOX.flags
					.slice(0, 12)
					.map(
						(f) =>
							`<li><span class="mono">${esc(clock(f.at))}</span><span>${esc(f.text)}${safeUrl(f.href) ? ` <a href="${esc(f.href)}" target="_blank" rel="noopener">↗</a>` : ""}</span></li>`,
					)
					.join("")}</ul></section>`
			: "";
	return `${head}${seg}<div class="ibx-list">${list}</div>${prs}${flags}`;
}

// "What I did": the agents' steps, each with the link that shows it, then the judging run's
// conversation and the proof when there is one.
function stepsOf(c) {
	const done = Array.isArray(c.card.done) ? c.card.done : c.card.done ? [c.card.done] : [];
	const steps = done.map((s) => (typeof s === "string" ? { text: s } : s));
	const judge = /^agent:([\w.-]+)$/.exec(c.judgedBy ?? "");
	if (judge && !steps.some((s) => s.href === `run:${judge[1]}`))
		steps.push({ text: T.judgedIn, href: `run:${judge[1]}`, label: T.conversation });
	if (safeUrl(c.evidence?.href) && !steps.some((s) => s.href === c.evidence.href))
		steps.push({ text: T.proofState(c.evidence.state), href: c.evidence.href, label: T.proof });
	return steps;
}
function stepHtml(s) {
	const run = /^run:([\w.-]+)$/.exec(s.href ?? "");
	const link = run
		? `<button type="button" class="linkish" data-run="${esc(run[1])}">${esc(s.label || T.conversation)}</button>`
		: safeUrl(s.href)
			? `<a href="${esc(s.href)}" target="_blank" rel="noopener">${esc(s.label || T.link)}</a>`
			: "";
	return `<li>${esc(s.text)}${link ? ` ${link}` : ""}</li>`;
}

// A card's question and its answer, one block for the inbox and for its item's card in the graph,
// so the two never differ: the question, what the agent did, then the options, the recommended one
// first. An option is sent with a second tap, on its Send; a free answer has its own Send.
// `compact` is a phone's layout, or a node's width; `field` names the free answer's text area.
function answerHtml(c, compact, field) {
	const d = c.card;
	const runsOn = (S?.runs ?? []).filter((r) => r.session && r.items?.includes(c.item));
	const ctx = esc(d.ctx).replace(/(Missing:[\s\S]*)$/, '<span class="missing">$1</span>');
	// A rule proposal: the rule as it will read, its file, and the cards it answers.
	const seen = (k) => {
		const o = INBOX.cards.find((x) => x.item === k);
		const n = `#${k.split("#")[1]}`;
		return o
			? `<button type="button" class="linkish mono" data-card="${esc(o.card.id)}">${esc(n)}</button>`
			: `<span class="mono">${esc(n)}</span>`;
	};
	const rule =
		c.type === "rule"
			? `<blockquote class="rule-text">${esc(d.rule)}</blockquote><span class="rule-file">${T.ruleAddedTo} <span class="mono">${esc(d.file)}</span></span><div class="seen">${T.seenOn} ${d.items.map(seen).join("")}</div>`
			: "";
	const steps = stepsOf(c);
	const list = `<ul>${steps.map(stepHtml).join("")}</ul>`;
	const did = !steps.length
		? ""
		: compact
			? `<details class="cv-did"><summary>${esc(runsOn.length ? T.whatIDidCount(runsOn.length) : T.whatIDid)}</summary>${list}</details>`
			: `<section class="cv-did"><h3>${T.whatIDid}</h3>${list}</section>`;
	let body;
	if (c.answer)
		body = `<div class="done-box" role="status">${CHECK}<div><b>${esc(T.answeredCard(answerLabel(c)))}</b><span><span class="dot pulse"></span>${T.carriedOut}</span></div></div>`;
	else {
		const rec = d.options.find((o) => o.id === d.rec);
		const ordered = [...(rec ? [rec] : []), ...d.options.filter((o) => o !== rec)];
		const chosen = picked.get(d.id);
		const opt = (o, small) =>
			`<button type="button" class="cv-opt${small ? " small" : ""}${o === rec ? " rec" : ""}" data-option="${esc(o.id)}" aria-pressed="${chosen === o.id}"><span class="cv-opt-label"><b>${esc(o.label)}</b>${o === rec ? `<span class="badge">${T.recommended}</span>` : ""}</span>${small && compact ? "" : `<span class="cv-opt-effect">${esc(o.effect)}</span>`}</button>`;
		const rest = ordered.slice(2);
		const pick = d.options.find((o) => o.id === chosen);
		body = `<div class="cv-opts">${ordered
			.slice(0, 2)
			.map((o) => opt(o, false))
			.join(
				"",
			)}${rest.length ? `<div class="cv-grid">${rest.map((o) => opt(o, true)).join("")}</div>` : ""}</div>
			${pick ? `<div class="cv-confirm"><button type="button" class="send-option" data-send>${esc(T.sendOption(pick.label))}</button>${pick.message ? `<small>${T.postsOnGitHub} ${esc(pick.message)}</small>` : ""}</div>` : ""}
			${
				// A setting is allowed or not, never answered in words (the validated mockup).
				yesOrNo(c)
					? ""
					: `<label for="${esc(field)}" class="cv-free-label">${compact ? T.ownWordsShort : c.type === "rule" ? T.ownWordsRule : T.ownWords}</label>
			<div class="cv-free"><textarea id="${esc(field)}" data-free="${esc(d.id)}" rows="2"></textarea><button type="button" class="send" data-send-free${compact ? ` aria-label="${T.send}"` : ""}>${compact ? ARROW : T.send}</button></div>`
			}`;
	}
	return `<h2 class="cv-q">${esc(d.q)}</h2><p class="cv-ctx">${ctx}</p>${rule}${did}${body}`;
}

// The open card, in place of the inbox: what it is about, then its answer block.
function cardViewHtml(c) {
	const d = c.card;
	const ph = phone();
	const runsOn = (S?.runs ?? []).filter((r) => r.session && r.items?.includes(c.item));
	const kind = c.kind
		? `<span class="tag" style="--tag:${KIND_COLOR[c.kind] ?? UNJUDGED_COLOR}">${esc(T.kinds[c.kind] ?? c.kind)}</span>`
		: "";
	const back = queueOf(c) === "rules" ? T.rulesQueue : T.inbox;
	const top = `<div class="cv-top"><button type="button" class="cv-back" data-back>${BACK}${back}</button><span class="grow"></span>${safeUrl(c.url) ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${T.gitHubLink} ↗</a>` : ""}${!ph && runsOn.length ? `<button type="button" class="linkish" data-runs="${esc(c.item)}">${esc(T.conversationCount(runsOn.length))}</button>` : ""}</div>`;
	// A setting's tag names it, and a rule proposal is about no one item.
	const ref = c.type === "setting" || c.type === "rule" ? "" : refOf(c);
	const chips = `<div class="cv-chips"><span class="cv-project">${esc(c.projectTitle)}</span>${ref ? `<span class="mono">${esc(ref)}</span>` : ""}${aboutTag(c)}${kind}<span class="tag you">${esc(T.forYouUrgency(d.urgency))}</span>${c.author && !ph ? `<span class="cv-by">${esc(T.byAuthor(c.author))}</span>` : ""}</div>`;
	return `<article class="cv${yesOrNo(c) ? " setting" : ""}" aria-label="${T.decision}" data-answer="${esc(d.id)}">${top}${chips}${answerHtml(c, ph, "cv-free")}</article>`;
}

let inboxKey = "";
function renderInbox() {
	const c = openCard();
	// Back from a card is its queue's list.
	if (c) ui.queue = queueOf(c);
	// Ages move once a minute in the list; an open card is rebuilt only when it changes, so typing
	// in it is never cut.
	const key = JSON.stringify([
		INBOX,
		ui.card,
		ui.queue,
		c ? (picked.get(c.card.id) ?? null) : null,
		phone(),
		c ? (S?.runs ?? []).filter((r) => r.items?.includes(c.item)).map((r) => r.id) : null,
		ui.card ? 0 : Math.floor(Date.now() / 60000),
	]);
	if (key === inboxKey) return;
	inboxKey = key;
	const el = $("inbox");
	el.classList.toggle("card-mode", !!ui.card);
	keepTyping(el, () => {
		el.innerHTML = !ui.card
			? inboxListHtml()
			: c
				? cardViewHtml(c)
				: `<article class="cv"><div class="cv-top"><button type="button" class="cv-back" data-back>${BACK}${T.inbox}</button></div><p class="cv-gone">${T.cardGone}</p></article>`;
	});
}

async function sendAnswer(c, option, note = "") {
	try {
		await post("/api/answer", {
			project: c.project,
			item: c.item,
			card: c.card.id,
			option,
			note,
		});
		picked.delete(c.card.id);
		drafts.delete(c.card.id);
		toast(T.answerSent);
		// A setting allowed or declined is done with: back to the inbox.
		if (yesOrNo(c)) location.hash = "inbox";
	} catch (err) {
		toast(T.answerFailed(err.message), true);
	}
}

// The open card's node, centred once in the graph; a card of another project shows that project,
// once: a project picked afterwards in the header stays.
let followed = null;
function centerOn(id) {
	const node = S.model.nodes.find((x) => x.id === id);
	const vp = $("vp");
	if (!node || !vp.clientWidth) return false;
	ui.z = Math.max(ui.z, 0.8);
	ui.px = vp.clientWidth / 2 - (node.x + W / 2) * ui.z;
	ui.py = vp.clientHeight * 0.4 - (node.y + 38) * ui.z;
	applyTransform();
	save();
	return true;
}
function followCard() {
	const c = openCard();
	if (!c || !S || followed === ui.card) return;
	if (c.project !== ui.project) {
		ui.project = c.project;
		ui.fitted = false;
		graphKey = "";
		save();
		connect();
		return;
	}
	if (phone() || ui.view !== "graph" || centerOn(c.item)) followed = ui.card;
}
function readHash() {
	const conv = /^#conv\/(.+)$/.exec(location.hash);
	ui.conv = conv ? decodeURIComponent(conv[1]) : null;
	const m = /^#card\/(.+)$/.exec(location.hash);
	const id = m ? decodeURIComponent(m[1]) : null;
	if (id === ui.card) return;
	ui.card = id;
	followed = null;
}

// ── Header, footer, drawer ────────────────────────────────────────────────────────────────────
const runName = (r) =>
	`${r.title || r.kind}${r.items?.length ? ` · ${r.items.map(numOfKey).join(", ")}` : ""}`;

function agentsNow() {
	const runs = AGENTS.runs;
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
	for (const el of document.querySelectorAll("#agents-view [data-since]"))
		el.textContent = elapsed(el.dataset.since);
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

// The journal and the rules, in a drawer over the view.
function renderDrawer() {
	const el = $("drawer");
	el.hidden = !drawerOpen;
	if (!drawerOpen) return;
	const journalHtml =
		(S.journal ?? [])
			.map(
				(j) =>
					`<li${j.notify ? ' class="flag"' : ""}><span class="mono">${clock(j.at)}</span><span>${j.item ? `<button type="button" class="secondary small" data-focus="${esc(j.item)}">${esc(numOfKey(j.item))}</button> ` : ""}${esc(j.text)}${safeUrl(j.href) ? ` <a href="${esc(j.href)}" target="_blank" rel="noopener">↗</a>` : ""}</span></li>`,
			)
			.join("") || `<li class="empty">${T.emptyJournal}</li>`;
	// A project without a repo has a journal, but no rules nor locks: nothing merges there.
	const rules = S.project?.repos.length
		? `<section><h2>${T.rulesAndLocks}</h2>${rulesHtml()}</section>`
		: "";
	const html = `
		<h2>${T.journal} <button type="button" class="secondary" data-close>${T.close}</button></h2>
		<section><ul class="journal">${journalHtml}</ul></section>${rules}`;
	// Rebuilt only when it changes: the 2-second updates keep its scroll and the button under the mouse.
	if (html === drawerHtml) return;
	const scroll = el.scrollTop;
	drawerHtml = html;
	el.innerHTML = html;
	el.scrollTop = scroll;
}
let drawerHtml = "";

// ── Agents: what runs now, the recurring tasks, the recent runs, the project's (T043, FR-097) ─
const AT_WORK = ["running", "queued"];
// A run a card points at (its conversation links) is lit.
const lit = (r) => runFocus && (r.id === runFocus || r.items?.includes(runFocus));
const runLabel = (r) => `${T.runKinds[r.kind] ?? r.kind}${r.title ? ` ${r.title}` : ""}`;
// A run's item, named as the inbox names it when its project is the one shown, by number otherwise.
const itemRef = (project, key) => {
	const n = String(key).split("#")[1];
	const node = S?.project?.id === project ? S.model.nodes.find((x) => x.id === key) : null;
	return node?.type === "pr" ? T.prRef(n) : node?.type === "issue" ? T.issueRef(n) : `#${n}`;
};
const runRef = (r) =>
	r.items?.length
		? `${itemRef(r.project, r.items[0])}${r.items.length > 1 ? ` +${r.items.length - 1}` : ""}`
		: "";
// A run's conversation opens where one reads it: on this PC in a terminal, as "Open in terminal"
// does; from a phone or another machine of the tailnet, where no terminal opens, in the reader.
const onThisPc = () => !phone() && ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
const openRunAttr = () => (onThisPc() ? "data-terminal" : "data-conv");
const conversationLink = (r) =>
	r.conversation
		? `<button type="button" class="linkish" ${openRunAttr()}="${esc(r.conversation)}">${T.conversation}</button>`
		: "";
// The model a run's session said it runs on (FR-098), marked when it is not the one asked for (an
// alias asked, such as opus, is part of the full id announced).
const modelHtml = (r) => {
	if (!r.model) return "";
	const off = r.modelAsked && !r.model.includes(r.modelAsked);
	return `<span class="mono ag-model${off ? " off" : ""}"${off ? ` title="${esc(T.modelAsked(r.modelAsked))}"` : ""}>${esc(r.model)}</span>`;
};
const stateDot = (r) =>
	`<i class="sd ${esc(r.state)}" role="img" aria-label="${esc(T.runState[r.state] ?? r.state)}"></i>`;

function runCardHtml(r) {
	const queued = r.state === "queued";
	const time = queued
		? `<span>${T.queued}</span>`
		: `<span class="mono" data-since="${esc(r.startedAt ?? r.createdAt)}"></span>`;
	return `<div class="ag-run${lit(r) ? " lit" : ""}" id="run-${esc(r.id)}">
		<div class="ag-head">${stateDot(r)}<b class="ag-name">${esc(runLabel(r))}</b><span class="mono">${esc(runRef(r))}</span><span class="grow"></span>${modelHtml(r)}${time}</div>
		${queued ? "" : `<span class="ag-step clamp2" title="${esc(plain(r.step))}">${md(r.step) || T.starting}</span>`}
		<div class="ag-actions">${queued ? "" : conversationLink(r)}<span class="grow"></span><button type="button" class="ag-stop${stopArmed === r.id ? " armed" : ""}" data-stop="${esc(r.id)}">${stopArmed === r.id ? T.confirmStop : T.stop}</button></div>
	</div>`;
}

// A task's last run: its state and when, the time it has worked when at work.
function lastRunOf(t) {
	const r = t.runs[0];
	if (!r) return { state: "", html: esc(T.neverRun), short: T.neverRun };
	const label = T.runState[r.state] ?? r.state;
	if (r.state === "running")
		return {
			state: r.state,
			html: `${esc(label)} · <span class="mono" data-since="${esc(r.startedAt ?? r.createdAt)}"></span>`,
			short: label,
		};
	if (r.state === "queued") return { state: r.state, html: esc(label), short: label };
	if (r.state === "limited" && r.retryAt)
		return { state: r.state, html: esc(T.limitedUntil(clock(r.retryAt))), short: label };
	const at = r.endedAt ?? r.createdAt;
	return {
		state: r.state,
		html: `${esc(label)} · ${esc(when(at))}`,
		short: `${label} ${shortWhen(at)}`,
	};
}

const miniRunHtml = (r) =>
	`<div class="ag-mini">${stateDot(r)}<span class="mono">${esc(shortWhen(r.endedAt ?? r.createdAt))}</span><span class="ag-sum" title="${esc(plain(r.summary))}">${md(r.summary) || esc(T.runState[r.state] ?? r.state)}</span>${conversationLink(r)}</div>`;

// One row per task; a click unfolds the start of its prompt and its last three runs. "Run now" shows
// only where it would start something.
function taskHtml(t, ph) {
	const open = openTasks.has(t.id);
	const last = lastRunOf(t);
	const meta = t.lock !== `${t.project}.task.${t.id}` ? T.lockOf(t.lock) : "";
	const schedule = t.schedule ?? T.onClick;
	const runNow =
		!AGENTS.dry && !t.error && t.state === "idle"
			? `<button type="button" class="secondary ag-run-now" data-run-task="${esc(t.id)}">${T.runNow}</button>`
			: "";
	const name = `<b>${esc(t.title)}</b>`;
	const head = ph
		? `<span class="ag-task-name">${name}<small class="st ${esc(last.state)}">${esc(last.short)} · ${esc(schedule)}</small></span>`
		: `<span class="ag-task-name">${name}${meta ? `<small>${esc(meta)}</small>` : ""}</span><span${t.schedule ? ' class="mono"' : ""}>${esc(schedule)}</span><span>${t.nextSlot ? esc(when(t.nextSlot)) : ""}</span><span class="st ${esc(last.state)}">${last.html}</span>`;
	const more = open
		? `<div class="ag-more">
			<div class="ag-col"><span class="ag-label">${T.prompt}</span><pre class="ag-prompt">${esc(t.promptStart)}</pre><a href="/api/tasks/${encodeURIComponent(t.id)}/file" target="_blank" rel="noopener">${T.openTaskFile}</a></div>
			<div class="ag-col"><span class="ag-label">${T.lastRuns}</span>${t.runs.slice(0, 3).map(miniRunHtml).join("") || `<p class="ag-empty">${T.none}</p>`}</div>
		</div>`
		: "";
	return `<div class="ag-task${open ? " open" : ""}">
		<div class="ag-grid ag-task-row"><button type="button" class="ag-task-head" data-task="${esc(t.id)}" aria-expanded="${open}">${head}</button><span class="ag-task-act">${runNow}</span></div>
		${t.error ? `<p class="ag-err">${esc(t.error)}</p>` : ""}${more}
	</div>`;
}

// A recent run: one line on a desktop, two on a phone, where the whole line opens its conversation.
function recentHtml(r, ph) {
	const at =
		r.state === "limited" && r.retryAt
			? T.limitedUntil(clock(r.retryAt))
			: shortWhen(r.endedAt ?? r.createdAt);
	const who = `${stateDot(r)}<b class="ag-name">${esc(runLabel(r))}</b>`;
	const sum = `<span class="ag-sum${ph ? " clamp2" : ""}" title="${esc(plain(r.summary))}">${md(r.summary)}</span>`;
	const attrs = `class="ag-line${lit(r) ? " lit" : ""}" id="run-${esc(r.id)}"`;
	if (!ph)
		return `<div ${attrs}>${who}${sum}${modelHtml(r)}<span class="mono">${esc(at)}</span>${conversationLink(r)}</div>`;
	const inner = `<span class="ag-line-head">${who}<span class="grow"></span>${modelHtml(r)}<span class="mono">${esc(at)}</span></span>${sum}`;
	return r.conversation
		? `<button type="button" ${attrs} ${openRunAttr()}="${esc(r.conversation)}">${inner}</button>`
		: `<div ${attrs}>${inner}</div>`;
}

let agentsHtml = "";
let scrolledTo = null;
// ── Machines (T071, the validated mockup): a card each in the Agents view ────────────────────
const OS_NAME = { windows: "Windows", macos: "macOS", linux: "Linux" };
const runById = (id) => AGENTS.runs.find((r) => r.id === id);
const leaseRunName = (id) => esc(runById(id) ? runLabel(runById(id)) : id);
const sinceNow = (iso) => span(Math.abs(Date.parse(iso) - Date.now()));
function machineHtml(m) {
	const p = m.probe;
	const lease = p?.state === "online" ? p.lease : null;
	const state = !p ? "unknown" : p.state === "offline" ? "off" : lease ? "held" : "free";
	let line = T.notProbed;
	if (state === "off")
		line = esc(T.machineOffline(p.tailnet?.lastSeen ? sinceNow(p.tailnet.lastSeen) : null, p.said));
	else if (lease?.unreadable) line = esc(T.leaseUnreadable);
	else if (lease) {
		const r = runById(lease.run);
		const next = m.queue.find((q) => q.run !== lease.run);
		line = T.heldBy(
			leaseRunName(lease.run),
			r ? esc(runRef(r)) : "",
			sinceNow(lease.expires),
			next ? { run: leaseRunName(next.run), wait: sinceNow(next.since) } : null,
		);
	} else if (state === "free") line = esc(m.owner ? T.machineFreeAsks(m.owner) : T.machineFree);
	const armed = releaseArmed === m.name;
	const r = lease && !lease.unreadable ? runById(lease.run) : null;
	const actions = lease
		? `<div class="ag-actions">${r ? conversationLink(r) : ""}<span class="grow"></span><button type="button" class="ag-stop${armed ? " armed" : ""}" data-release="${esc(m.name)}">${armed ? T.confirmRelease : T.release}</button></div>`
		: "";
	return `<div class="ag-run mc ${state}" id="machine-${esc(m.name)}">
		<div class="ag-head"><i class="mc-dot ${state}"></i><b class="ag-name">${esc(m.name)}</b><span>${OS_NAME[m.os] ?? esc(m.os)}</span>${m.owner ? `<span class="mc-desk">${esc(T.desktopOf(m.owner))}</span>` : ""}<span class="grow"></span>${p ? `<span>${esc(T.probed(sinceNow(p.checkedAt)))}</span>` : ""}</div>
		<div class="mc-tags">${[m.os, ...m.caps].map((t) => `<span>${esc(t)}</span>`).join("")}</div>
		<span class="mc-state ${state}">${line}</span>${actions}
	</div>`;
}

function renderAgents() {
	const el = $("agents-view");
	if (el.hidden) return;
	const ph = phone();
	const live = AGENTS.runs.filter((r) => AT_WORK.includes(r.state));
	// A run that found nothing to do had no conversation: not worth a line.
	const recent = AGENTS.runs
		.filter((r) => !AT_WORK.includes(r.state) && (r.conversation || r.state !== "done"))
		.slice(0, 30);
	const cols = ph
		? ""
		: `<div class="ag-grid ag-cols"><span>${T.colTask}</span><span>${T.colSchedule}</span><span>${T.colNext}</span><span>${T.colLastRun}</span><span></span></div>`;
	const html = `
		<section aria-label="${T.runningNow}"><h2>${T.runningNow}</h2>${live.length ? `<div class="ag-running">${live.map(runCardHtml).join("")}</div>` : `<p class="ag-empty">${T.nothingRunning}</p>`}</section>
		${AGENTS.machines?.machines.length ? `<section aria-label="${T.machines}"><h2>${T.machines}</h2><div class="ag-running">${AGENTS.machines.machines.map(machineHtml).join("")}</div></section>` : ""}
		<section aria-label="${T.recurringTasks}"><h2>${T.recurringTasks}</h2>${AGENTS.tasks.length ? cols + AGENTS.tasks.map((t) => taskHtml(t, ph)).join("") : `<p class="ag-empty">${T.noTasks}</p>`}</section>
		<section aria-label="${T.recentRuns}"><h2>${T.recentRuns}<span class="grow"></span><button type="button" class="linkish" data-journal>${T.journalAndRules}</button></h2>${recent.map((r) => recentHtml(r, ph)).join("") || `<p class="ag-empty">${T.none}</p>`}</section>`;
	// Rebuilt only when it changes, keeping its scroll; the times at work tick in place.
	if (html !== agentsHtml) {
		const scroll = el.scrollTop;
		agentsHtml = html;
		el.innerHTML = html;
		el.scrollTop = scroll;
		tick();
	}
	if (runFocus && scrolledTo !== runFocus) {
		scrolledTo = runFocus;
		el.querySelector(".lit")?.scrollIntoView({ block: "center" });
	}
}

// ── Conversations (T061, the validated mockups) ──────────────────────────────────────────────
// The project's Claude conversations by item, then the one open in the reader, a page at a time.
const CONV_DOT = { live: "#34b27b", running: "#d97757" };
const convState = (c) =>
	c.live
		? "live"
		: c.runState === "running"
			? "running"
			: c.runState === "failed"
				? "failed"
				: c.run
					? "done"
					: "ended";
const convOrigin = (c) =>
	c.origin === "rusuban"
		? `${T.origins.rusuban}${c.runKind ? ` · ${c.runKind}` : ""}`
		: (T.origins[c.origin] ?? c.origin);
// A reply forks unless Rusuban started the session and its run has ended (research R6b).
const convForks = (c) => !c.run || ["queued", "running"].includes(c.runState);
// An item no longer open is not in the live state: its number alone, not a guess at its type.
const refOfKey = (key) => {
	const info = HUB.items?.[key];
	const n = key.split("#")[1];
	return !info ? `#${n}` : info.type === "pr" ? T.prRef(n) : T.issueRef(n);
};
let convDraft = { id: null, text: "" };

function convRowHtml(c, current) {
	const state = convState(c);
	const age = span(
		Date.now() -
			Date.parse((state === "live" || state === "running" ? c.firstAt : c.lastAt) ?? Date.now()),
	);
	if (c.forkOf)
		return `<button type="button" class="cl-row fork${current ? " current" : ""}" data-conv="${esc(c.id)}"${current ? ' aria-current="true"' : ""}>
			<span class="cl-fork-body"><b>${esc(T.forkOf(clock(c.firstAt)))}</b><span>${esc(convOrigin(c))} · ${esc(T.convStates[state])}</span></span>
			<span class="mono">${esc(clock(c.lastAt))}</span></button>`;
	return `<button type="button" class="cl-row${current ? " current" : ""}" data-conv="${esc(c.id)}"${current ? ' aria-current="true"' : ""}>
		<span class="cl-title"><i class="dot" style="background:${CONV_DOT[state] ?? "#a1a1aa"}"></i><b>${esc(c.title)}</b></span>
		<span class="cl-meta"><span>${esc(convOrigin(c))}</span><span>·</span><span class="st ${state}">${esc(T.convStates[state])}</span><span class="grow"></span><span class="mono">${esc(age)}</span></span>
	</button>`;
}

function convListHtml() {
	const list = HUB.conversations.filter((c) => ui.origin === "all" || c.origin === ui.origin);
	const age = HUB.indexedAt ? span(Date.now() - Date.parse(HUB.indexedAt)) : null;
	const chips = Object.entries(T.origins)
		.map(
			([id, label]) =>
				`<button type="button" class="chip" data-origin="${id}" aria-pressed="${ui.origin === id}">${esc(label)}</button>`,
		)
		.join("");
	// One group per item, the unlinked ones last; a fork right under the conversation it came from.
	const groups = new Map();
	const byId = new Map(list.map((c) => [c.id, c]));
	for (const c of list) {
		if (c.forkOf && byId.has(c.forkOf)) continue;
		const key = `${c.project}|${c.items[0] ?? ""}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(c, ...list.filter((f) => f.forkOf === c.id));
	}
	// The open items' groups first, then those of items since closed, then the runs about none.
	const rank = (key) => {
		const item = key.split("|")[1];
		return !item ? 2 : HUB.items?.[item] ? 0 : 1;
	};
	const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));
	const groupHtml = ordered
		.map(([key, cs]) => {
			const [, item] = key.split("|");
			const title = item ? HUB.items?.[item]?.title : null;
			const head = item
				? `<span class="mono">${esc(refOfKey(item))}</span>${title ? `<b>${esc(title)}</b>` : ""}`
				: `<b>${T.notLinked}</b>`;
			return `<div class="cl-group"><div class="cl-ghead">${head}</div>${cs.map((c) => convRowHtml(c, c.id === ui.conv)).join("")}</div>`;
		})
		.join("");
	return `<div class="cl-head"><h2>${T.conversations}</h2><span>${esc(age ? T.indexedAgo(list.length, age) : T.notIndexed)}</span></div>
		<div class="cl-chips" role="group" aria-label="${T.startedFrom}">${chips}</div>
		<div class="cl-groups">${groupHtml || `<p class="ag-empty">${T.noConversations}</p>`}</div>`;
}

function entriesHtml(entries) {
	const out = [];
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (e.kind === "user") out.push(`<div class="cr-user">${esc(e.text)}</div>`);
		else if (e.kind === "assistant") out.push(`<p class="cr-said">${esc(e.text)}</p>`);
		else if (e.kind === "tool") {
			const result = entries[i + 1]?.kind === "result" ? entries[++i].text : null;
			out.push(
				`<div class="cr-tool"><span><b>${esc(e.name)}</b><span class="mono">${esc(e.input ?? "")}</span></span>${result ? `<pre>${esc(result)}</pre>` : ""}</div>`,
			);
		} else out.push(`<div class="cr-tool"><pre>${esc(e.text)}</pre></div>`);
	}
	return out.join("");
}

function convReaderHtml(c) {
	const ph = phone();
	if (!c) return ph ? "" : `<p class="cr-empty">${T.pickConversation}</p>`;
	const state = convState(c);
	const status =
		state === "live" || state === "running"
			? `<span class="cr-live"><i class="dot"></i>${esc(T.liveIn[c.origin] ?? T.liveIn.rusuban)}</span>`
			: `<span>${esc(T.endedAgo(span(Date.now() - Date.parse(c.lastAt ?? Date.now()))))}</span>`;
	const refs = c.items.map((k) => `<span class="mono">${esc(refOfKey(k))}</span>`).join("");
	const top = ph
		? `<div class="cr-bar"><button type="button" class="cv-back" data-conv-back>${BACK}${T.conversations}</button><span class="grow"></span>${refs}</div>`
		: "";
	const page = READER?.id === c.id ? READER : null;
	return `${top}<div class="cr-head">
		<div class="cr-top"><h1>${esc(c.title)}</h1>${ph ? "" : `<button type="button" class="secondary" data-terminal="${esc(c.id)}">${T.openInTerminal}</button>`}</div>
		<div class="cr-meta">${status}${ph ? "" : refs}${c.branch ? `<span class="mono">${esc(c.branch)}</span>` : ""}${!ph && c.firstAt ? `<span>${esc(T.startedAt(clock(c.firstAt)))}</span>` : ""}</div>
	</div>
	<div class="cr-body" id="cr-body">${page?.before != null ? `<button type="button" class="cr-earlier" data-earlier>${T.earlier}</button>` : ""}${page ? entriesHtml(page.entries) : ""}</div>
	<div class="cr-answer"><label for="cr-text" class="vh">${T.answer}</label><textarea id="cr-text" rows="2"></textarea>
		<div class="cr-send"><button type="button" class="send-option" data-reply="${esc(c.id)}">${convForks(c) ? T.answerInFork : T.answer}</button></div></div>`;
}

let convListKey = "";
let convReaderKey = "";
function renderConversations() {
	const el = $("conversations");
	if (el.hidden) return;
	if (!el.querySelector("#conv-list"))
		el.innerHTML =
			'<section class="cl" id="conv-list"></section><section class="cr" id="conv-reader"></section>';
	const c = HUB.conversations.find((x) => x.id === ui.conv) ?? null;
	el.classList.toggle("reading", !!c);
	const list = convListHtml();
	if (list !== convListKey) {
		const box = $("conv-list");
		const scroll = box.scrollTop;
		convListKey = list;
		box.innerHTML = list;
		box.scrollTop = scroll;
	}
	// The reader is rebuilt only when its conversation or its page changes: typing is never cut.
	const reader = convReaderHtml(c);
	if (reader !== convReaderKey) {
		convReaderKey = reader;
		$("conv-reader").innerHTML = reader;
		const area = $("cr-text");
		if (area && convDraft.id === ui.conv) area.value = convDraft.text;
		const body = $("cr-body");
		if (body && !READER?.earlier) body.scrollTop = body.scrollHeight;
	}
	if (c && (READER?.id !== c.id || READER.lastAt !== c.lastAt) && !READER?.loading)
		loadConversation(c.id);
}

async function loadConversation(id, before = null) {
	if (!id) return;
	const keep = before !== null && READER?.id === id ? READER : null;
	READER = { ...(keep ?? {}), id, loading: true };
	try {
		const res = await fetch(
			`/api/conversations/${encodeURIComponent(id)}${before !== null ? `?before=${before}` : ""}`,
		);
		const page = await res.json();
		const c = HUB.conversations.find((x) => x.id === id);
		READER = keep
			? { ...page, entries: [...page.entries, ...keep.entries], earlier: true, lastAt: keep.lastAt }
			: { ...page, lastAt: c?.lastAt ?? null };
	} catch {
		READER = { id, before: null, entries: [], lastAt: null };
	}
	renderConversations();
}

function openConversation(id) {
	ui.view = "conversations";
	if (phone()) ui.tab = "conversations";
	save();
	location.hash = `conv/${encodeURIComponent(id)}`;
}

async function sendReply(id) {
	const text = $("cr-text")?.value.trim();
	if (!text) return $("cr-text")?.focus();
	try {
		const r = await post(`/api/conversations/${encodeURIComponent(id)}/reply`, { text });
		convDraft = { id: null, text: "" };
		$("cr-text").value = "";
		toast(T.replied(r.forked));
	} catch (err) {
		toast(err.message, true);
	}
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
	// The inbox needs no project state: it shows as soon as it arrives.
	renderInbox();
	const count = waiting().length;
	$("tab-count").textContent = count ? String(count) : "";
	// A project without a repo has no graph or kanban: Agents, its tasks and runs, shows instead.
	const repoless = !!S?.project && !S.project.repos.length;
	const tab = repoless && ui.tab === "graph" ? "agents" : ui.tab;
	// On a phone one screen shows at a time, picked in the tab bar; an open card covers them all.
	document.body.dataset.tab = tab;
	document.body.classList.toggle("card-open", !!ui.card);
	// A phone reads a conversation full screen, like a card.
	document.body.classList.toggle(
		"conv-open",
		phone() && tab === "conversations" && !!ui.conv && !ui.card,
	);
	$("tab-board").hidden = repoless;
	for (const b of document.querySelectorAll("#tabbar [data-tab]"))
		b.setAttribute("aria-current", b.dataset.tab === tab && !ui.card ? "page" : "false");
	if (!S) return;
	const M = S.model;
	renderProjects();
	$("auto").setAttribute("aria-checked", String(S.armed));
	$("paused").hidden = S.armed;
	$("observe").hidden = !S.project?.observeOnly;
	$("observe-text").innerHTML = T.observeText(S.project?.defaultBranch);
	$("dry").hidden = !S.dry;
	$("nomodel").hidden = !!S.runModel;
	// On a phone, Conversations and Agents have tabs of their own; the first tab shows the graph or the
	// kanban, picked in its row of view tabs, and is named after the one it shows.
	const board = ui.view === "kanban" ? "kanban" : "graph";
	const picked = phone() ? (["conversations", "agents"].includes(tab) ? tab : board) : ui.view;
	const view = repoless && ["graph", "kanban"].includes(picked) ? "agents" : picked;
	$("tab-board").textContent = T[board];
	for (const b of document.querySelectorAll(".views button")) {
		b.setAttribute("aria-selected", String(b.dataset.view === view));
		b.hidden = repoless && ["graph", "kanban"].includes(b.dataset.view);
	}
	// Nothing is read on GitHub for it either.
	$("fresh").hidden = repoless;
	document.body.dataset.showing = view;
	$("vp").hidden = view !== "graph";
	$("kanban").hidden = view !== "kanban";
	$("conversations").hidden = view !== "conversations";
	$("agents-view").hidden = view !== "agents";
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
	if (view === "graph") {
		renderGraph();
		if (!ui.fitted) ui.fitted = fit();
		applyTransform();
	} else if (view === "kanban") renderKanban();
	renderAgents();
	renderConversations();
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
$("menu").onclick = () => {
	const open = !document.body.classList.contains("menu-open");
	document.body.classList.toggle("menu-open", open);
	$("menu").setAttribute("aria-expanded", String(open));
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
	ui.view = "agents";
	runFocus = null;
	save();
	render();
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

// The inbox, its cards and the runs: what a click there does.
function cardClick(t) {
	// The card a control belongs to: the inbox's open card, or the one on an item's card.
	const host = t.closest("[data-answer]");
	const c = host ? entryOf(host.dataset.answer) : openCard();
	const d = t.dataset;
	if (d.card) location.hash = `card/${encodeURIComponent(d.card)}`;
	else if (d.back !== undefined) location.hash = "inbox";
	else if (d.queue) {
		ui.queue = d.queue;
		save();
		renderInbox();
	} else if (d.option && c) {
		picked.set(c.card.id, picked.get(c.card.id) === d.option ? null : d.option);
		render();
	} else if (d.send !== undefined && c && picked.get(c.card.id))
		sendAnswer(c, picked.get(c.card.id));
	else if (d.sendFree !== undefined && c) {
		const area = host.querySelector("textarea[data-free]");
		const note = area?.value.trim();
		if (note) sendAnswer(c, "other", note);
		else area?.focus();
	} else if (d.sendAsk) {
		const area = t.closest("[data-ask]").querySelector("textarea");
		const text = area.value.trim();
		if (!text) area.focus();
		else
			post("/api/ask", { project: S.project.id, item: d.sendAsk, text })
				.then(() => {
					// The node may have been drawn again meanwhile: clear the field as it is now.
					drafts.delete(area.dataset.free);
					for (const x of document.querySelectorAll("textarea[data-free]"))
						if (x.dataset.free === area.dataset.free) x.value = "";
					toast(T.askSent);
				})
				.catch((err) => toast(T.askFailed(err.message), true));
	} else if (d.stop) {
		if (stopArmed !== d.stop) {
			stopArmed = d.stop;
			return renderAgents();
		}
		stopArmed = null;
		post(`/api/runs/${encodeURIComponent(d.stop)}/stop`)
			.then(() => toast(T.runStopped))
			.catch((err) => toast(T.stopFailed(err.message), true));
	} else if (d.release) {
		if (releaseArmed !== d.release) {
			releaseArmed = d.release;
			return renderAgents();
		}
		releaseArmed = null;
		post(`/api/machines/${encodeURIComponent(d.release)}/release`)
			.then(() => toast(T.released(d.release)))
			.catch((err) => toast(T.releaseFailed(err.message), true));
	} else if (d.runTask) {
		const t = AGENTS.tasks.find((x) => x.id === d.runTask);
		post(`/api/tasks/${encodeURIComponent(d.runTask)}/run`)
			.then(() => toast(T.taskStarted(t?.title ?? d.runTask)))
			.catch((err) => toast(T.runRefused(err.message), true));
	} else if (d.task) {
		if (openTasks.has(d.task)) openTasks.delete(d.task);
		else openTasks.add(d.task);
		renderAgents();
	} else if (d.journal !== undefined) {
		drawerOpen = true;
		renderDrawer();
	} else if (d.run || d.runs) {
		// A card's conversations: the Agents view, the runs lit; a phone shows it alone, card closed.
		runFocus = d.run || d.runs;
		scrolledTo = null;
		ui.view = "agents";
		if (phone()) {
			ui.tab = "agents";
			location.hash = "agents";
		}
		save();
		render();
	} else if (d.conv) openConversation(d.conv);
	else if (d.convBack !== undefined) location.hash = "conversations";
	else if (d.origin) {
		ui.origin = d.origin;
		save();
		renderConversations();
	} else if (d.earlier !== undefined) loadConversation(READER?.id, READER?.before);
	else if (d.reply) sendReply(d.reply);
	else if (d.terminal)
		post(`/api/conversations/${encodeURIComponent(d.terminal)}/terminal`)
			.then(() => toast(T.openedInTerminal))
			.catch((err) => toast(err.message, true));
	else if (d.tab) {
		ui.tab = d.tab;
		if (ui.card || ui.conv) location.hash = d.tab;
		save();
		render();
	} else return false;
	return true;
}

document.addEventListener("input", (e) => {
	if (e.target.dataset?.free) drafts.set(e.target.dataset.free, e.target.value);
	if (e.target.id === "cr-text") convDraft = { id: ui.conv, text: e.target.value };
});

document.addEventListener("click", (e) => {
	if (e.target.closest("a[href]")) return;
	// The tab bar's own buttons only: <body> carries the current tab too, and every click reaches it.
	const card = e.target.closest(
		"[data-card],[data-back],[data-queue],[data-option],[data-send],[data-send-free],[data-send-ask],[data-stop],[data-release],[data-run-task],[data-task],[data-journal],[data-run],[data-runs],[data-conv],[data-conv-back],[data-origin],[data-earlier],[data-reply],[data-terminal],#tabbar [data-tab]",
	);
	// A Stop pressed once is forgotten at the next click elsewhere.
	if (stopArmed && !card?.dataset.stop) {
		stopArmed = null;
		renderAgents();
	}
	if (releaseArmed && !card?.dataset.release) {
		releaseArmed = null;
		renderAgents();
	}
	if (card && cardClick(card)) return;
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
	else if (t.dataset.view) {
		ui.view = t.dataset.view;
		// A phone shows Conversations and Agents on their own tabs: the tab bar follows.
		if (phone() && ["conversations", "agents"].includes(ui.view)) ui.tab = ui.view;
	} else if (t.dataset.close !== undefined) drawerOpen = false;
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
		followCard();
	});
	// The inbox holds every project's cards: it comes with every project's stream.
	es.addEventListener("inbox", (ev) => {
		INBOX = JSON.parse(ev.data);
		render();
		followCard();
	});
	// The project's Claude conversations, for the Conversations view and the items' details.
	es.addEventListener("hub", (ev) => {
		HUB = JSON.parse(ev.data);
		render();
	});
	// The project's runs and tasks, for the Agents view and the header.
	es.addEventListener("agents", (ev) => {
		AGENTS = JSON.parse(ev.data);
		render();
	});
	es.onerror = () => {
		$("offline").hidden = false;
	};
}
// The address names the open card (#card/<id>), so a ping's link opens it.
window.addEventListener("hashchange", () => {
	readHash();
	render();
	followCard();
});
PHONE.addEventListener("change", () => render());
readHash();
connect();
setInterval(tick, 1000);
applyTransform();
