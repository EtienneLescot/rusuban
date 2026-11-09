// The core, without side effects. From live GitHub state, the agents' judgments and each repo's
// rules and locks, it derives every PR's gates, its eligibility for a merge, what the agents must do,
// the graph's links and where each node sits. The server uses it to merge and to draw the page; the
// agent CLI uses it to validate what agents write. Items are keyed `owner/repo#n`.

export const W = 232; // width of a folded node
export const H = 76;
const COL = 320; // step between two layers
const ROW = 100; // step between two rows

export const KINDS = ["bug", "feature", "maintenance", "docs", "translation", "question", "other"];
export const GATES = [
	"CI",
	"Reviews",
	"Threads",
	"Mergeable",
	"Judgment",
	"Locks",
	"Evidence",
	"Switch",
];
export const EVIDENCE_STATES = ["todo", "running", "ok", "fail"];
const ROLES = ["agent", "third"];
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
// "Same files" links ignore what nearly every PR touches: lockfiles, manifests and docs.
const SHARED_IGNORE = [
	/\.md$/,
	/(^|\/)package(-lock)?\.json$/,
	/\.lock$/,
	/(^|\/)pnpm-lock\.yaml$/,
	/(^|\/)go\.sum$/,
];
const HUB_AT = 4;

export const keyOf = (item) => `${item.repo}#${item.n}`;
export const isPerson = (owner) =>
	typeof owner === "string" && !ROLES.includes(owner) && LOGIN.test(owner);
const gate = (state, detail) => ({ state, detail });
const fail = (msg) => {
	throw new Error(msg);
};
const few = (list) => `${list.slice(0, 2).join(", ")}${list.length > 2 ? "…" : ""}`;

// A reference to an item: a number or "#12" in the same repo, or "owner/repo#12".
export function refKey(ref, repo) {
	if (Number.isInteger(ref)) return `${repo}#${ref}`;
	const m = /^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/.exec(String(ref ?? "").trim());
	return m ? `${m[1] ?? repo}#${Number(m[2])}` : null;
}

// An item given on the command line, checked against the project's repos.
export function parseItem(ref, repos) {
	const m = /^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/.exec(String(ref ?? "").trim());
	if (!m) fail(`"${ref}" is not an item: write owner/repo#n, or #n when the project has one repo`);
	if (m[1] && !repos.includes(m[1])) fail(`${m[1]} is not a repo of this project`);
	if (!m[1] && repos.length !== 1) fail(`write owner/repo#${m[2]}: this project has several repos`);
	return `${m[1] ?? repos[0]}#${Number(m[2])}`;
}

// ── Locks ─────────────────────────────────────────────────────────────────────────────────────
// Globs of the locks file: `*` and `?` stay within a path segment, `**` crosses them, and a pattern
// without a slash matches a file name at any depth, as in .gitignore.
export function globToRegExp(glob) {
	const g = glob.includes("/") ? glob.replace(/^\//, "") : `**/${glob}`;
	let re = "";
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "*" && g[i + 1] === "*") {
			if (g[i + 2] === "/") {
				re += "(?:.*/)?";
				i += 2;
			} else {
				re += ".*";
				i += 1;
			}
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}$`);
}

const matcher = (globs) => {
	const res = (globs ?? []).map(globToRegExp);
	return (p) => res.some((r) => r.test(p));
};

export function sizeOf(pr, locks = {}) {
	const exempt = matcher(locks.sizeExempt);
	const counted = pr.files.filter((f) => !exempt(f.path));
	return {
		lines: counted.reduce((s, f) => s + f.additions + f.deletions, 0),
		files: counted.length,
	};
}

// ── Gates ─────────────────────────────────────────────────────────────────────────────────────
// CI green, as FR-021 defines it: at least one check on the head; every check run and status on it
// succeeded, or was neutral or skipped; none pending, failed, cancelled, timed out or waiting for an
// approval; and every name in requiredChecks (a check, or a whole workflow) has a success on it.
// The checks the locks name in ignoredChecks do not count, but never all of them: a head whose only
// checks are ignored is not green.
function ciGate(pr, required, ignored = []) {
	const counts = (name) => !ignored.includes(name);
	const all = pr.checks ?? [];
	const checks = all.filter((c) => counts(c.name) && (!c.workflow || counts(c.workflow)));
	const named = (state) => [...new Set(checks.filter((c) => c.state === state).map((c) => c.name))];
	const runsOf = (name) => checks.filter((c) => c.name === name || c.workflow === name);
	const failed = named("failure");
	if (failed.length) return gate("fail", `CI failed: ${few(failed)}`);
	// Present, finished and never a success: skipped or neutral where the project wants a success.
	const skipped = required.filter((name) => {
		const runs = runsOf(name);
		return runs.length && runs.every((c) => c.state === "skipped");
	});
	if (skipped.length) return gate("fail", `Required but skipped: ${skipped.join(", ")}`);
	// A fork's workflows awaiting approval, unless every one of them is ignored by name.
	const waiting = pr.ci?.waiting ?? [];
	const approval = [...waiting.filter(counts), ...named("waiting")];
	if (approval.length || (pr.ci?.state === "action_required" && !waiting.length))
		return gate("wait", `Awaiting approval: ${few([...new Set(approval)]) || "fork workflows"}`);
	if (!checks.length)
		return gate("todo", all.length ? "Only ignored checks on the head" : "No check on the head");
	const pending = named("pending");
	if (pending.length) return gate("wait", `CI running: ${few(pending)}`);
	const missing = required.filter((name) => !runsOf(name).length);
	if (missing.length) return gate("wait", `Required but not run: ${missing.join(", ")}`);
	return gate("ok", "CI green on the head");
}

// Reviews: changes requested on the head stop a merge; required reviewers must have reviewed the head.
function reviewsGate(pr, required) {
	const norm = (login) => login.toLowerCase().replace(/\[bot\]$/, "");
	const reviews = Object.entries(pr.reviews ?? {});
	const changes = reviews.filter(([, s]) => s === "CHANGES_REQUESTED").map(([l]) => `@${l}`);
	if (changes.length) return gate("fail", `Changes requested by ${changes.join(", ")}`);
	if (!required.length) return gate("na", "No required reviewer");
	const done = new Set(
		reviews.filter(([, s]) => s === "APPROVED" || s === "COMMENTED").map(([l]) => norm(l)),
	);
	const missing = required.filter((l) => !done.has(norm(l)));
	if (missing.length)
		return gate("wait", `Waiting for ${missing.map((l) => `@${l}`).join(", ")} on the head`);
	return gate("ok", "Required reviews on the head");
}

function mergeableGate(pr, method) {
	if (pr.draft) return gate("fail", "Draft");
	if (pr.mergeable === "CONFLICTING")
		return gate("fail", `Conflicts with ${pr.base ?? "its base"}`);
	if (pr.mergeable === "UNKNOWN") return gate("wait", "GitHub is computing mergeability");
	// Without a mergeMethod in the locks, the strictest merge, a rebase, is assumed.
	if ((method ?? "rebase") === "rebase" && pr.canBeRebased === false)
		return gate("fail", "Cannot be rebased (a merge commit?)");
	return gate("ok", `Mergeable into ${pr.base ?? "its base"}`);
}

function judgmentGate(pr, j, observeOnly) {
	if (observeOnly) return gate("fail", "Observe only: no rules in .rusuban/rules/");
	if (!j) return gate("todo", "Not judged yet");
	if (j.pr?.head !== pr.head) return gate("todo", "New commit: to judge again");
	if (!j.pr.auto) return gate("fail", j.pr.why || "Judged not to merge alone");
	return gate("ok", j.pr.why || "Judged mergeable alone");
}

const OWN_FOLDER = /^\.rusuban(\/|$)/;
function locksGate(pr, rules) {
	const paths = pr.files.map((f) => f.path);
	if (paths.some((p) => OWN_FOLDER.test(p)))
		return gate("fail", "Changes .rusuban/: a person merges these");
	if (rules.errors?.length) return gate("fail", `Invalid ${rules.errors[0]}`);
	if (pr.filesTruncated) return gate("fail", `Too many files to check (${pr.files.length} listed)`);
	// ponytail: GitHub's GraphQL gives no old path for a rename, so a rename could move a file out of
	// a locked path unseen; renames are refused here. Read REST `previous_filename` to lift this.
	const renamed = pr.files.filter((f) => f.change === "RENAMED").map((f) => f.path);
	if (renamed.length) return gate("fail", `Renamed files: ${few(renamed)}`);
	const locks = rules.locks ?? {};
	const locked = paths.filter(matcher(locks.lockedPaths));
	if (locked.length) return gate("fail", `Locked paths: ${few(locked)}`);
	const size = sizeOf(pr, locks);
	if (
		(locks.maxLines && size.lines > locks.maxLines) ||
		(locks.maxFiles && size.files > locks.maxFiles)
	)
		return gate("fail", `Size: ${size.lines} lines, ${size.files} files`);
	return gate("ok", "Within the locks");
}

// Evidence: a PR touching the paths a lock names needs a proof recorded on its head. Files the size
// locks exempt (tests, docs) do not count: they change no behavior to prove.
function evidenceGate(pr, j, locks) {
	const exempt = matcher(locks.sizeExempt);
	const zones = (locks.evidence ?? []).filter((e) => {
		const inZone = matcher(e.paths);
		return pr.files.some((f) => !exempt(f.path) && inZone(f.path));
	});
	const ev = j?.pr?.evidence;
	if (!zones.length && !ev?.needed) return gate("na", "No proof needed");
	const what = `Proof needed: ${zones.map((z) => z.what).join("; ") || "as the judgment says"}`;
	if (ev?.head !== pr.head) return gate("todo", what);
	return (
		{
			ok: gate("ok", "Proof recorded on the head"),
			running: gate("wait", "Proof running"),
			fail: gate("fail", "The proof shows an impact"),
		}[ev.state] ?? gate("todo", what)
	);
}

// `rules` is the PR's repo entry of rules.json. Until rules are loaded and say otherwise, the repo
// is only observed: the Judgment gate stays shut.
export function gatesOf(pr, j, { rules = {}, armed = false } = {}) {
	const locks = rules.locks ?? {};
	return [
		ciGate(pr, locks.requiredChecks ?? [], locks.ignoredChecks ?? []),
		reviewsGate(pr, locks.requiredReviewers ?? []),
		pr.threadsOpen > 0
			? gate("fail", `${pr.threadsOpen} open thread${pr.threadsOpen > 1 ? "s" : ""}`)
			: gate("ok", "No open thread"),
		mergeableGate(pr, locks.mergeMethod),
		judgmentGate(pr, j, rules.observeOnly !== false),
		locksGate(pr, rules),
		evidenceGate(pr, j, locks),
		armed ? gate("ok", "Merges armed") : gate("fail", "Merges paused"),
	].map((g, i) => ({ name: GATES[i], ...g }));
}

export const isEligible = (gates) => gates.every((g) => g.state === "ok" || g.state === "na");

// ── The approval bypass (FR-029) ──────────────────────────────────────────────────────────────
// `--admin` skips every rule of the branch, not only its approval: what stops it is checked here, from
// the branch's rules as GitHub returns them. Rules that never stop a merge pass; a rule this code does
// not know stops the bypass, so a new kind of rule never slips through it.
const PUSH_ONLY = ["creation", "deletion", "non_fast_forward"];
const APPROVAL_ONLY = [
	"required_approving_review_count",
	"dismiss_stale_reviews_on_push",
	"require_last_push_approval",
	"require_extra_approval_for_unattributed_changes",
	"required_reviewers",
	"dismissal_restriction",
];
const PR_RULE_KEYS = [
	...APPROVAL_ONLY,
	"allowed_merge_methods",
	"require_code_owner_review",
	"required_review_thread_resolution",
];

// Classic branch protection, as `GET /branches/{b}/protection` returns it (null: none), read like the
// rulesets: approval and push-only settings pass, a setting `--admin` would skip stops the bypass, and
// so does one this code does not know.
const CLASSIC_KNOWN = [
	"url",
	"required_status_checks",
	"required_pull_request_reviews",
	"required_linear_history",
	"required_conversation_resolution",
	"required_signatures",
	"enforce_admins",
	"restrictions",
	"lock_branch",
	"allow_force_pushes",
	"allow_deletions",
	"block_creations",
	"allow_fork_syncing",
];
const CLASSIC_REVIEWS = [
	"url",
	"dismissal_restrictions",
	"dismiss_stale_reviews",
	"required_approving_review_count",
	"require_last_push_approval",
	"bypass_pull_request_allowances",
	"require_code_owner_reviews",
];
const on = (setting) => setting?.enabled === true;
function classicStops(c, method, pr) {
	if (!c) return [];
	const stops = [];
	const reviews = c.required_pull_request_reviews ?? {};
	if (c.required_status_checks?.strict)
		stops.push("the branch requires PRs up to date with it, which the bypass cannot check");
	if (reviews.require_code_owner_reviews) stops.push("the branch requires a code owner's review");
	if (on(c.required_linear_history) && method === "merge")
		stops.push("the branch requires a linear history, and the merge method is merge");
	if (on(c.required_conversation_resolution) && pr.threadsOpen > 0)
		stops.push("a review thread is open");
	if (on(c.required_signatures))
		stops.push("the branch requires signed commits, which the bypass cannot check");
	if (on(c.enforce_admins)) stops.push("the branch's protection binds administrators too");
	if (c.restrictions) stops.push("the branch restricts who can push to it");
	if (on(c.lock_branch)) stops.push("the branch is locked");
	const unknown = [
		...Object.keys(c).filter((k) => !CLASSIC_KNOWN.includes(k)),
		...Object.keys(reviews).filter((k) => !CLASSIC_REVIEWS.includes(k)),
	];
	if (unknown.length) stops.push(`the branch's protection has ${unknown.join(", ")}`);
	return stops;
}

// Every check the branch requires, with the app that must report it (null: any).
export function requiredChecksOf({ rules = [], classic = null }) {
	const out = rules
		.filter((r) => r.type === "required_status_checks")
		.flatMap((r) =>
			r.parameters.required_status_checks.map((c) => ({
				name: c.context,
				app: c.integration_id ?? null,
			})),
		);
	if (classic) {
		const c = classic.required_status_checks ?? {};
		out.push(
			...(c.checks?.length
				? c.checks.map((x) => ({ name: x.context, app: x.app_id ?? null }))
				: (c.contexts ?? []).map((name) => ({ name, app: null }))),
		);
	}
	return out;
}

// Why the server may not merge `pr` with `--admin`: an empty list means it may. A required check
// counts only from the app the rule names, in its latest run on the head, and only as `success`; a
// status counts only where the rule names no app.
export function bypassStops({ rules = [], classic = null, runs = [], statuses = [], method, pr }) {
	const stops = [];
	for (const r of rules) {
		const p = r.parameters ?? {};
		if (PUSH_ONLY.includes(r.type)) continue;
		if (r.type === "required_linear_history") {
			if (method === "merge")
				stops.push("the branch requires a linear history, and the merge method is merge");
		} else if (r.type === "required_status_checks") {
			if (p.strict_required_status_checks_policy)
				stops.push("the branch requires PRs up to date with it, which the bypass cannot check");
		} else if (r.type === "pull_request") {
			if (p.allowed_merge_methods && !p.allowed_merge_methods.includes(method))
				stops.push(`the branch does not allow the ${method} method`);
			if (p.require_code_owner_review) stops.push("the branch requires a code owner's review");
			if (p.required_review_thread_resolution && pr.threadsOpen > 0)
				stops.push("a review thread is open");
			const unknown = Object.keys(p).filter((k) => !PR_RULE_KEYS.includes(k));
			if (unknown.length) stops.push(`the branch's pull request rule has ${unknown.join(", ")}`);
		} else stops.push(`the branch has a ${r.type} rule, which the bypass cannot check`);
	}
	stops.push(...classicStops(classic, method, pr));
	for (const { name, app } of requiredChecksOf({ rules, classic })) {
		const latest = runs
			.filter((x) => x.name === name && (app === null || x.app === app))
			.sort((a, b) => b.id - a.id)[0];
		const status = app === null ? statuses.find((s) => s.context === name) : null;
		const state = latest
			? latest.status === "completed"
				? latest.conclusion
				: latest.status
			: status?.state;
		if (state !== "success") stops.push(`${name} is ${state ?? "missing"} on the head`);
	}
	return [...new Set(stops)]; // a ruleset and classic protection may require the same thing
}

// ── State helpers ─────────────────────────────────────────────────────────────────────────────
// live.json holds one entry per repo; the model works on the project's items side by side.
export function flatten(liveFile) {
	const repos = Object.values(liveFile?.repos ?? {});
	return {
		prs: repos.flatMap((r) => r.prs ?? []),
		issues: repos.flatMap((r) => r.issues ?? []),
		merged: repos.flatMap((r) => r.merged ?? []).sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1)),
	};
}

// The repos whose rules are loaded: the only ones agents act on.
export const actingRepos = (rules) =>
	new Set(
		Object.entries(rules ?? {})
			.filter(([, r]) => r && r.observeOnly === false)
			.map(([slug]) => slug),
	);

// ── What the agents must do ───────────────────────────────────────────────────────────────────
const hasOpenCard = (j) => !!(j?.decision && !j.decision.resolvedAt);

// What stops a PR judged mergeable alone on its head: a project lock (paths, size, evidence) or the
// rules-folder lock. A person's merge order on a card lifts it for that head (FR-022, FR-044). A
// broken locks file is not one: it is fixed in the repo, not on a card per PR.
function lockStop(pr, j, rules = {}) {
	if (j?.pr?.head !== pr.head || j.pr.auto !== true || rules.errors?.length) return null;
	const g = gatesOf(pr, j, { rules });
	return g.find((x) => (x.name === "Locks" || x.name === "Evidence") && x.state === "fail") ?? null;
}

// A PR judged mergeable alone that its base moved under: it conflicts, or cannot be rebased for a
// rebase merge. An agent rebases it; nothing else would until its revisitAt.
function conflicts(pr, j, rules = {}) {
	if (j?.pr?.head !== pr.head || j.pr.auto !== true || pr.draft) return false;
	return mergeableGate(pr, rules.locks?.mergeMethod).state === "fail";
}

// The merges GitHub refused, from the project's journal (T116): `owner/repo#n@head` → the refusals of
// that head, oldest first, each with its time, whether it was through the bypass, and GitHub's reason.
export function refusedOf(journal = []) {
	const out = new Map();
	for (const e of journal)
		if (e.kind === "merge-refused" && e.head) {
			const k = `${e.item}@${e.head}`;
			out.set(k, [...(out.get(k) ?? []), { at: e.at, admin: e.admin === true, text: e.text }]);
		}
	return out;
}

// The reasons of contracts/cli.md, plus `conflict`. No delay is built in: an item comes back to the
// agents at its judgment's revisitAt, which the agent sets from the project's rules. Items of repos
// without rules never appear (FR-024). A refusal comes once: a card written after it settles it. A
// fork's CI approval comes once per head: `examined` holds, per PR, the head a judge ended on.
export function todoOf({
	live,
	judgment,
	rules = {},
	refused = new Map(),
	examined = {},
	now = Date.now(),
}) {
	const acting = actingRepos(rules);
	const items = judgment.items ?? {};
	const out = [];
	const open = new Map(
		[...live.prs, ...live.issues].filter((i) => acting.has(i.repo)).map((i) => [keyOf(i), i]),
	);
	for (const pr of live.prs) {
		if (!acting.has(pr.repo)) continue;
		const item = keyOf(pr);
		const j = items[item];
		const stop = hasOpenCard(j) ? null : lockStop(pr, j, rules[pr.repo]);
		const refusal = refused.get(`${item}@${pr.head}`)?.at(-1);
		if (!j) out.push({ item, type: "pr", reason: "unjudged" });
		else if (j.pr?.head !== pr.head)
			out.push({ item, type: "pr", reason: "new-commit", head: pr.head });
		else if (
			refusal &&
			!hasOpenCard(j) &&
			(!j.decision || Date.parse(refusal.at) > Date.parse(j.decision.createdAt))
		)
			out.push({ item, type: "pr", reason: "merge-refused", head: pr.head, why: refusal.text });
		else if (stop)
			out.push({
				item,
				type: "pr",
				reason: "lock-blocked",
				head: pr.head,
				lock: `${stop.name}: ${stop.detail}`,
			});
		else if (!hasOpenCard(j) && conflicts(pr, j, rules[pr.repo]))
			out.push({ item, type: "pr", reason: "conflict", head: pr.head, base: pr.base });
		if (pr.ci.state === "action_required" && examined[item] !== pr.head)
			out.push({
				item,
				type: "pr",
				reason: "ci-approval",
				head: pr.head,
				runIds: pr.ci.runIds,
				waiting: pr.ci.waiting,
			});
	}
	for (const is of live.issues)
		if (acting.has(is.repo) && !items[keyOf(is)])
			out.push({ item: keyOf(is), type: "issue", reason: "unjudged" });
	for (const [item, j] of Object.entries(items)) {
		if (!open.has(item)) continue;
		if (isPerson(j.owner) && !hasOpenCard(j))
			out.push({ item, type: j.type, reason: "missing-card" });
		if (ROLES.includes(j.owner) && !(Date.parse(j.revisitAt) > now))
			out.push({ item, type: j.type, reason: "revisit-due", revisitAt: j.revisitAt ?? null });
	}
	return out;
}

// ── Writing judgments (the agent CLI is their only writer) ────────────────────────────────────
const isRefList = (v) => Array.isArray(v) && v.every((x) => refKey(x, "o/r") !== null);

// The item a judgment is about: `item` ("owner/repo#n" or "#n"), or `n` in a one-repo project.
export const inputKey = (input, repos) => parseItem(input.item ?? String(input.n ?? ""), repos);

// Validates one judgment against the live state, then merges it into the judgment file's items.
export function applyJudgment(
	input,
	live,
	judgment,
	{ repos, now = new Date().toISOString(), by = null },
) {
	const key = inputKey(input, repos);
	const pr = live.prs.find((p) => keyOf(p) === key);
	const issue = live.issues.find((i) => keyOf(i) === key);
	if (!pr && !issue) fail(`${key} is neither an open PR nor an open issue`);
	const type = pr ? "pr" : "issue";
	const prev = judgment.items[key] ?? {};
	const next = { ...prev, ...input, type };
	delete next.item;
	delete next.n;
	if (typeof next.label !== "string" || !next.label.trim() || next.label.length > 60)
		fail(`${key}: label is required, 60 characters at most`);
	if (!KINDS.includes(next.kind)) fail(`${key}: kind is one of ${KINDS.join(", ")}`);
	if (!ROLES.includes(next.owner) && !isPerson(next.owner))
		fail(`${key}: owner is "agent", "third" or a GitHub login`);
	if (next.owner === "third" && !next.waits)
		fail(`${key}: waits is required when owner is "third" (@author, the reporter, a release…)`);
	if (typeof next.next !== "string" || !next.next.trim())
		fail(`${key}: next is required: what comes next, in one sentence`);
	if (next.priority != null && !/^P[0-3]$/.test(next.priority))
		fail(`${key}: priority is P0, P1, P2 or P3`);
	if (ROLES.includes(next.owner)) {
		// Required on every judgment: it is when the item comes back to the agents, set from the rules.
		if (!(Date.parse(input.revisitAt) > Date.parse(now)))
			fail(
				`${key}: revisitAt is required when owner is "${next.owner}": a future date, set from the rules`,
			);
		next.revisitAt = new Date(input.revisitAt).toISOString();
	} else delete next.revisitAt;
	next.links = { issues: [], before: [], duplicateOf: null, ...prev.links, ...input.links };
	for (const k of ["issues", "before"])
		if (!isRefList(next.links[k]))
			fail(`${key}: links.${k} is a list of items (12, "#12" or "owner/repo#12")`);
	if (next.links.duplicateOf != null && refKey(next.links.duplicateOf, "o/r") === null)
		fail(`${key}: links.duplicateOf is an item or null`);
	if (type === "pr") {
		if (!input.pr || input.pr.head !== pr.head)
			fail(`${key}: pr.head must be the live head ${pr.head}`);
		if (typeof input.pr.auto !== "boolean") fail(`${key}: pr.auto must be true or false`);
		// A judgment may ask for a proof, never record one: a worker other than the judging run does,
		// with `rusuban evidence` (FR-022). A proof follows the head: it does not survive a new commit.
		const asked = input.pr.evidence;
		if (asked != null && ((asked.state ?? "todo") !== "todo" || asked.needed !== true))
			fail(
				`${key}: a judgment only asks for a proof, pr.evidence { "needed": true }; a worker records it with \`rusuban evidence\``,
			);
		const kept = prev.pr?.evidence?.head === pr.head ? prev.pr.evidence : null;
		const evidence = kept ?? (asked ? { needed: true, state: "todo", head: pr.head } : null);
		next.pr = { head: pr.head, auto: input.pr.auto, why: input.pr.why ?? "", evidence };
	} else delete next.pr;
	if (input.decision) {
		const d = input.decision;
		if (!isPerson(next.owner))
			fail(`${key}: a card goes to a person: set owner to their GitHub login`);
		if (d.to != null && d.to !== next.owner)
			fail(`${key}: decision.to must be the owner, ${next.owner}`);
		if (!d.q || !d.ctx || !Array.isArray(d.options) || d.options.length < 2)
			fail(`${key}: decision is { urgency, done, q, ctx, rec, why, options[2+] }`);
		// What the agents did: a sentence or two, or a list of steps, each with the link that shows it
		// (a comment, a report, `run:<id>` for a run's conversation).
		const steps = Array.isArray(d.done) ? d.done : [d.done];
		const step = (s) =>
			(typeof s === "string" && s.trim()) ||
			(typeof s?.text === "string" &&
				s.text.trim() &&
				(s.href == null || /^(https?:\/\/|run:[\w.-]+$)/.test(s.href)));
		if (!steps.length || !steps.every(step))
			fail(
				`${key}: decision.done is required: what the agent already did or checked, a sentence or a list of { text, href? } (href a URL or run:<id>)`,
			);
		if (!["now", "digest"].includes(d.urgency))
			fail(`${key}: decision.urgency is "now" or "digest", from the rules`);
		for (const o of d.options) {
			if (!o.id || !o.label || !o.effect) fail(`${key}: every option has id, label and effect`);
			// A merge order (FR-044): the server merges the PR on the head this card was written on.
			if (o.merge !== undefined && (o.merge !== true || type !== "pr"))
				fail(`${key}: option "${o.id}": merge is true, on a PR's card only`);
		}
		if (new Set(d.options.map((o) => o.id)).size !== d.options.length)
			fail(`${key}: option ids must be unique`);
		if (d.rec && !d.options.some((o) => o.id === d.rec))
			fail(`${key}: decision.rec must be the id of an option`);
		const head = pr?.head ?? null;
		// The same question on the same head is the same card; a new head makes a new one, so an answer
		// never orders a merge of a commit its person did not see.
		const same =
			prev.decision &&
			!prev.decision.resolvedAt &&
			prev.decision.q === d.q &&
			(prev.decision.head ?? null) === head;
		next.decision = {
			...d,
			id: same
				? prev.decision.id
				: `${key}@${Date.parse(now)}-${Math.random().toString(36).slice(2, 6)}`,
			head,
			to: next.owner,
			createdAt: same ? prev.decision.createdAt : now,
			resolvedAt: null,
			outcome: null,
			state: "open",
		};
	}
	// An open card means the item waits on its person, and only then.
	if (isPerson(next.owner) && !(next.decision && !next.decision.resolvedAt))
		fail(`${key}: an item held by a person carries an open card (decision)`);
	if (!isPerson(next.owner) && next.decision && !next.decision.resolvedAt)
		next.decision = {
			...next.decision,
			resolvedAt: now,
			outcome: "Replaced by a new judgment",
			state: "replaced",
		};
	next.judgedAt = now;
	if (by) next.judgedBy = by;
	judgment.items[key] = next;
	return next;
}

// A proof for the live head, from a worker run other than the one that judged the item (FR-022,
// T095), with the run and its conversation attached.
export function applyEvidence(
	judgment,
	live,
	key,
	state,
	{ href = null, run = null, conversation = null, now = new Date().toISOString() } = {},
) {
	if (!EVIDENCE_STATES.includes(state)) fail(`state is one of ${EVIDENCE_STATES.join(", ")}`);
	const pr = live.prs.find((p) => keyOf(p) === key);
	if (!pr) fail(`${key} is not an open PR`);
	const it = judgment.items[key];
	if (!it?.pr) fail(`${key} is not judged yet`);
	if (!run) fail("a proof is recorded by a worker run");
	if (it.judgedBy === `agent:${run}`)
		fail(`${key}: the run that judged it cannot record its proof`);
	it.pr.evidence = { needed: true, state, head: pr.head, href, run, conversation, at: now };
	return it.pr.evidence;
}

const answersFor = (key, d, answers) =>
	answers.filter(
		(a) =>
			a.item === key &&
			(a.card ? a.card === d.id : Date.parse(a.at) >= Date.parse(d.createdAt ?? 0)),
	);

// Closes an open card with its outcome: resolved when it was answered, replaced otherwise.
export function closeCard(judgment, key, text, answers = [], now = new Date().toISOString()) {
	const d = judgment.items[key]?.decision;
	if (!d || d.resolvedAt) fail(`${key} has no open card`);
	if (!String(text ?? "").trim()) fail("say what happened, in a sentence");
	Object.assign(d, {
		resolvedAt: now,
		outcome: text,
		state: answersFor(key, d, answers).length ? "resolved" : "replaced",
	});
	return d;
}

// ── Cards (data-model.md, T036) ───────────────────────────────────────────────────────────────
// A card's state is derived, so no file has two writers: replaced when the agent CLI marked it so in
// judgment.json, resolved once answers.jsonl (the daemon's) holds an answer for it, open otherwise.
// The agent's `resolve` then closes it with what was done.
export function cardState(item, d, answers = []) {
	if (!d) return null;
	if (d.state === "replaced") return "replaced";
	if (d.state === "resolved" || answersFor(item, d, answers).length) return "resolved";
	return "open";
}

// An answer to a card (T037), checked before the daemon records it, once: a replaced card or one
// already answered refuses it. A free answer is option "other" with a note.
export function checkAnswer({ judgment, answers = [], item, card, option, note }) {
	const d = judgment.items?.[item]?.decision;
	if (!d || d.id !== card) return { status: 404, error: "this item has no such card" };
	const state = cardState(item, d, answers);
	if (state === "replaced")
		return { status: 409, error: "this card was replaced by a newer one: answer that one" };
	if (state === "resolved") return { status: 409, error: "this card is already answered" };
	const text = typeof note === "string" ? note.trim() : "";
	if (text.length > 2000) return { status: 400, error: "the note is over 2000 characters" };
	const chosen = d.options.find((o) => o.id === option) ?? null;
	if (!chosen && !(option === "other" && text))
		return { status: 400, error: "choose an option, or write a free answer" };
	return { chosen, note: text };
}

// The inbox (contracts/http.md): the cards of every project that wait for their person, or whose
// answer is being carried out, newest first.
export function inboxOf(projects) {
	const out = [];
	for (const { id, title, live, judgment, answers = [] } of projects) {
		const open = new Map([...live.prs, ...live.issues].map((i) => [keyOf(i), i]));
		for (const [key, j] of Object.entries(judgment.items ?? {})) {
			const d = j.decision;
			if (!d || d.resolvedAt || d.state === "replaced") continue;
			const it = open.get(key);
			out.push({
				project: id,
				projectTitle: title ?? id,
				item: key,
				type: j.type,
				label: j.label || it?.title || key,
				kind: j.kind ?? null,
				author: it?.author ?? null,
				url: it?.url ?? null,
				itemOpen: !!it,
				judgedBy: j.judgedBy ?? null,
				evidence: j.pr?.evidence ?? null,
				card: d,
				answer: answersFor(key, d, answers).at(-1) ?? null,
			});
		}
	}
	return out.sort((a, b) => String(b.card.createdAt).localeCompare(String(a.card.createdAt)));
}

// The latest answer to each open card.
export function pendingAnswers(judgment, answers) {
	const out = [];
	for (const [key, j] of Object.entries(judgment.items ?? {})) {
		const d = j.decision;
		if (!d || d.resolvedAt) continue;
		const a = answersFor(key, d, answers).at(-1);
		if (a)
			out.push({
				...a,
				item: key,
				card: d.id,
				q: d.q,
				chosen: d.options.find((o) => o.id === a.option) ?? null,
			});
	}
	return out;
}

// A person's merge orders (FR-044): an answered card whose chosen option says `merge: true`. The
// server still requires the switch armed, CI green, no open thread, no conflict and the head the card
// was written on: a paused switch holds an order until it is armed again;
// the project's own locks, the judgment's `auto` and the rules-folder lock (a person decided) are
// lifted for that head only.
export function mergeOrdersOf({ live, judgment, answers = [], rules = {}, armed = false }) {
	const out = [];
	for (const a of pendingAnswers(judgment, answers)) {
		if (a.chosen?.merge !== true) continue;
		const pr = live.prs.find((p) => keyOf(p) === a.item);
		if (!pr) continue;
		const d = judgment.items[a.item].decision;
		const locks = rules[pr.repo]?.locks ?? {};
		const gates = [
			ciGate(pr, locks.requiredChecks ?? [], locks.ignoredChecks ?? []),
			pr.threadsOpen > 0
				? gate("fail", `${pr.threadsOpen} open thread(s)`)
				: gate("ok", "No thread"),
			mergeableGate(pr, locks.mergeMethod),
			d.head === pr.head
				? gate("ok", "The head the card was written on")
				: gate("fail", "New commit since the card"),
			armed ? gate("ok", "Merges armed") : gate("fail", "Merges paused"),
		].map((g, i) => ({ name: ["CI", "Threads", "Mergeable", "Head", "Switch"][i], ...g }));
		out.push({
			item: a.item,
			pr,
			card: d.id,
			by: a.by ?? null,
			at: a.at,
			gates,
			eligible: isEligible(gates),
		});
	}
	return out;
}

// ── Graph ─────────────────────────────────────────────────────────────────────────────────────
// Directed links: addresses (issue → PR), before (PR → PR), duplicate. Undirected: same files.
export function edgesOf(live, items) {
	const issues = new Set(live.issues.map(keyOf));
	const prs = new Set(live.prs.map(keyOf));
	const open = (k) => issues.has(k) || prs.has(k);
	const edges = [];
	const seen = new Set();
	const add = (from, to, kind, label) => {
		const id =
			kind === "files" ? `${kind}:${[from, to].sort().join(":")}` : `${kind}:${from}:${to}`;
		if (from === to || seen.has(id)) return;
		seen.add(id);
		edges.push({ from, to, kind, label });
	};
	for (const pr of live.prs) {
		const k = keyOf(pr);
		const j = items[k];
		for (const ref of [...pr.closes, ...pr.refs, ...(j?.links?.issues ?? [])]) {
			const ik = refKey(ref, pr.repo);
			if (issues.has(ik)) add(ik, k, "addresses");
		}
		for (const ref of j?.links?.before ?? []) {
			const pk = refKey(ref, pr.repo);
			if (prs.has(pk)) add(pk, k, "before", "goes first");
		}
	}
	for (const [k, j] of Object.entries(items)) {
		const d = j.links?.duplicateOf;
		const dk = d == null ? null : refKey(d, k.split("#")[0]);
		if (dk && open(k) && open(dk)) add(k, dk, "duplicate", "duplicate of");
	}
	const keep = (p) => !SHARED_IGNORE.some((r) => r.test(p));
	const count = new Map();
	const fileKeys = (pr) => pr.files.filter((f) => keep(f.path)).map((f) => `${pr.repo}:${f.path}`);
	for (const pr of live.prs) for (const f of fileKeys(pr)) count.set(f, (count.get(f) ?? 0) + 1);
	const files = new Map(
		live.prs.map((pr) => [keyOf(pr), new Set(fileKeys(pr).filter((f) => count.get(f) < HUB_AT))]),
	);
	for (let a = 0; a < live.prs.length; a++)
		for (let b = a + 1; b < live.prs.length; b++) {
			const [A, B] = [live.prs[a], live.prs[b]]
				.sort((x, y) => y.n - x.n || (x.repo < y.repo ? -1 : 1))
				.map(keyOf);
			if (seen.has(`before:${A}:${B}`) || seen.has(`before:${B}:${A}`)) continue;
			const shared = [...files.get(A)].filter((p) => files.get(B).has(p)).length;
			if (shared) add(A, B, "files", `${shared} file${shared > 1 ? "s" : ""} in common`);
		}
	return edges;
}

// The group a node belongs to, seen by the instance owner `me`.
export const groupOf = (n, me) =>
	n.owner === me ? "mine" : n.owner === "agent" ? "agent" : "others";

// Deterministic placement: linked components in layers from left to right (issue, PR, PRs that go
// after), stacked by area over two columns; unlinked items in grids by group; main in between. A
// node moves only when its links change.
export function layout(nodes, edges, me = null) {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const order = (a, b) => byId.get(b).n - byId.get(a).n || (a < b ? -1 : a > b ? 1 : 0);
	const adj = new Map(nodes.map((n) => [n.id, new Set()]));
	// A subject is an issue and its PRs. "Same files" is a conflict risk, not a shared subject: it
	// does not group nodes, it is drawn over them.
	for (const e of edges) {
		if (e.kind === "files") continue;
		adj.get(e.from)?.add(e.to);
		adj.get(e.to)?.add(e.from);
	}
	const seen = new Set();
	const comps = [];
	for (const id of [...byId.keys()].sort(order)) {
		if (seen.has(id)) continue;
		const comp = [];
		const stack = [id];
		seen.add(id);
		while (stack.length) {
			const x = stack.pop();
			comp.push(x);
			for (const y of adj.get(x))
				if (!seen.has(y)) {
					seen.add(y);
					stack.push(y);
				}
		}
		comps.push(comp);
	}
	const linked = comps.filter((c) => c.length > 1);
	const isolated = comps.filter((c) => c.length === 1).map((c) => c[0]);

	const pos = new Map();
	const blocks = linked.map((comp) => {
		const inComp = new Set(comp);
		const directed = edges.filter(
			(e) => e.kind !== "files" && inComp.has(e.from) && inComp.has(e.to),
		);
		const layer = new Map(comp.map((id) => [id, byId.get(id).type === "pr" ? 1 : 0]));
		for (let i = 0; i < comp.length; i++)
			for (const e of directed) layer.set(e.to, Math.max(layer.get(e.to), layer.get(e.from) + 1));
		const layers = [];
		for (const id of comp) {
			layers[layer.get(id)] ??= [];
			layers[layer.get(id)].push(id);
		}
		const row = new Map();
		layers.forEach((ids, li) => {
			const score = (id) => {
				const prev = [...adj.get(id)]
					.filter((m) => inComp.has(m) && layer.get(m) < li && row.has(m))
					.map((m) => row.get(m));
				return prev.length ? prev.reduce((s, r) => s + r, 0) / prev.length : -1;
			};
			ids.sort((a, b) => score(a) - score(b) || order(a, b));
			const used = new Set();
			for (const id of ids) {
				let r = Math.max(0, Math.round(score(id)));
				while (used.has(r)) r++;
				used.add(r);
				row.set(id, r);
			}
		});
		const rows = Math.max(...comp.map((id) => row.get(id))) + 1;
		const cols = Math.max(...comp.map((id) => layer.get(id))) + 1;
		const top = Math.max(...comp.map((id) => byId.get(id).n));
		return { comp, layer, row, top, w: (cols - 1) * COL + W, h: (rows - 1) * ROW + H };
	});
	blocks.sort((a, b) => b.comp.length - a.comp.length || b.top - a.top);

	// One frame per area: the subjects of an area stack in its frame, 40 px apart. A subject's area is
	// the most frequent one among its items.
	const themeOf = (comp) => {
		const tally = {};
		for (const id of comp) {
			const a = byId.get(id).area;
			if (a) tally[a] = (tally[a] ?? 0) + 1;
		}
		return (
			Object.entries(tally).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? ""
		);
	};
	const themes = new Map();
	for (const b of blocks) {
		const t = themeOf(b.comp);
		if (!themes.has(t)) themes.set(t, []);
		themes.get(t).push(b);
	}
	const stacks = [...themes.entries()].map(([theme, bs]) => ({
		theme,
		blocks: bs,
		h: bs.reduce((s, b) => s + b.h, 0) + (bs.length - 1) * 40,
		w: Math.max(...bs.map((b) => b.w)),
	}));
	stacks.sort((a, b) => b.h - a.h || (a.theme < b.theme ? -1 : 1));

	// Two columns balanced in height; 120 px between two frames for the next one's title.
	const colH = [0, 0];
	const colW = [0, 0];
	for (const g of stacks) {
		const c = colH[0] <= colH[1] ? 0 : 1;
		g.col = c;
		g.y = colH[c];
		colH[c] += g.h + 120;
		colW[c] = Math.max(colW[c], g.w);
	}
	const colX = [0, colW[0] + 140];
	const frames = [];
	for (const g of stacks) {
		const x0 = colX[g.col];
		let y = g.y;
		for (const b of g.blocks) {
			for (const id of b.comp)
				pos.set(id, { x: x0 + b.layer.get(id) * COL, y: y + b.row.get(id) * ROW });
			y += b.h + 40;
		}
		frames.push({
			kind: "theme",
			theme: g.theme,
			members: g.blocks.flatMap((b) => b.comp),
			x: x0 - 30,
			y: g.y - 58,
			w: g.w + 60,
			h: g.h + 84,
		});
	}
	const compsRight = stacks.length ? Math.max(colX[0] + colW[0], colX[1] + colW[1]) : 0;

	const main = { x: compsRight + 120, y: 0 };
	const isoX = main.x + 260 + 160;
	const groups = [
		{ group: "mine", cols: 2 },
		{ group: "agent", cols: 2 },
		{ group: "others", cols: 3 },
	];
	let gy = 0;
	for (const g of groups) {
		const list = isolated.filter((id) => groupOf(byId.get(id), me) === g.group).sort(order);
		if (!list.length) continue;
		list.forEach((id, i) => {
			pos.set(id, { x: isoX + (i % g.cols) * 260, y: gy + Math.floor(i / g.cols) * ROW });
		});
		const rows = Math.ceil(list.length / g.cols);
		frames.push({
			kind: "group",
			group: g.group,
			count: list.length,
			members: list,
			x: isoX - 30,
			y: gy - 58,
			w: (Math.min(g.cols, list.length) - 1) * 260 + W + 60,
			h: (rows - 1) * ROW + H + 84,
		});
		gy += rows * ROW + 160;
	}
	return { pos, frames, main };
}

// A card that was answered and closed stays visible 48 h on its node: the owner sees it landed.
export function settledOf(key, j, answers = [], now = Date.now()) {
	const d = j?.decision;
	if (!d?.resolvedAt || now - Date.parse(d.resolvedAt) > 48 * 3600e3) return null;
	const a = answersFor(key, d, answers).at(-1);
	const choice = a ? (d.options.find((o) => o.id === a.option)?.label ?? a.note ?? null) : null;
	return {
		q: d.q,
		choice,
		outcome: d.outcome ?? "",
		state: d.state ?? "resolved",
		at: d.resolvedAt,
	};
}

// ── The whole model the page shows ────────────────────────────────────────────────────────────
export function buildModel({
	live,
	judgment,
	rules = {},
	answers = [],
	journal = [],
	runs = [],
	armed = false,
	me = null,
	now = Date.now(),
}) {
	const items = judgment.items ?? {};
	const edges = edgesOf(live, items);
	// Agents at work light their items: a run's own items, then the items its recent lines cite.
	const working = new Map();
	for (const r of runs) {
		if (r.state !== "running") continue;
		for (const k of [...(r.items ?? []), ...(r.focus ?? [])])
			if (!working.has(k)) working.set(k, r);
	}
	const node = (type, it, j) => {
		const id = keyOf(it);
		const open = j?.decision && !j.decision.resolvedAt ? j.decision : null;
		const answer = open ? (answersFor(id, open, answers).at(-1) ?? null) : null;
		const w = working.get(id);
		return {
			id,
			repo: it.repo,
			n: it.n,
			type,
			title: it.title,
			url: it.url,
			author: it.author,
			label: j?.label || it.title,
			kind: j?.kind ?? null,
			owner: j?.owner ?? "agent",
			unjudged: !j,
			waits: j?.waits ?? null,
			next: j?.next ?? "",
			block: j?.block ?? null,
			priority: j?.priority ?? null,
			area: j?.area ?? null,
			revisitAt: j?.revisitAt ?? null,
			overdue: ROLES.includes(j?.owner) && !(Date.parse(j.revisitAt) > now),
			decision: open ? { ...open, answer } : null,
			settled: settledOf(id, j, answers, now),
			activity: w ? { name: w.title || w.kind, step: w.step ?? "", since: w.startedAt } : null,
			observeOnly: rules[it.repo]?.observeOnly !== false,
		};
	};

	const nodes = [];
	for (const pr of live.prs) {
		const j = items[keyOf(pr)];
		const gates = gatesOf(pr, j, { rules: rules[pr.repo], armed });
		const n = node("pr", pr, j);
		const first =
			gates.find((g) => g.state === "fail") ??
			gates.find((g) => g.state === "todo" || g.state === "wait");
		n.gates = gates;
		n.eligible = isEligible(gates);
		n.firstBlock = first ? `${first.name}: ${first.detail}` : null;
		n.stale = !!j && j.pr?.head !== pr.head;
		// On the way to an automatic merge: judged mergeable on this head, no red gate but the switch.
		n.lane =
			!!j &&
			!n.stale &&
			j.pr?.auto === true &&
			!gates.some((g) => g.state === "fail" && g.name !== "Switch");
		nodes.push(n);
	}
	for (const is of live.issues) nodes.push(node("issue", is, items[keyOf(is)]));

	const flow = nodes.filter((n) => n.type === "pr" && n.lane);
	const { pos, frames, main } = layout(nodes, edges, me);
	for (const n of nodes) Object.assign(n, pos.get(n.id));
	if (flow.length) main.y = Math.round(flow.reduce((s, n) => s + n.y, 0) / flow.length);
	const ready = flow.filter((n) =>
		n.gates.every((g) => g.name === "Switch" || g.state === "ok" || g.state === "na"),
	);
	const readyLabel = armed ? "merges next cycle" : "ready, merges paused";
	for (const n of flow)
		edges.push({
			from: n.id,
			to: "main",
			kind: "main",
			live: n.eligible,
			label: ready.includes(n) ? readyLabel : null,
		});

	const mergedByServer = new Set(
		journal.filter((e) => e.kind === "merge" && e.by === "server").map((e) => e.item),
	);
	const merged = (live.merged ?? []).map((m) => ({
		...m,
		id: keyOf(m),
		auto: mergedByServer.has(keyOf(m)),
	}));
	const counts = { all: nodes.length, mine: 0, agent: 0, others: 0 };
	for (const n of nodes) counts[groupOf(n, me)]++;
	return {
		nodes,
		edges,
		frames,
		main: {
			...main,
			inFlight: flow.length,
			ready: ready.length,
			merged7: merged.length,
			mergedAuto: merged.filter((m) => m.auto).length,
		},
		merged,
		counts,
		armed,
	};
}
