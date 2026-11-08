// GitHub state, read for each repo of a project: open PRs, open issues, PRs merged and commits on the
// default branch in the last 7 days. Four GraphQL queries per repo through `gh`, already logged in.
// Items carry their repo, so several repos live side by side, keyed `owner/repo#n`. The one write is
// `mergePr`, which only the server calls, after its gates.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export async function gh(args) {
	const { stdout } = await execFileP("gh", args, {
		maxBuffer: 64 * 1024 * 1024,
		windowsHide: true,
	});
	return stdout;
}

// Raw string fields (-f), never typed ones (-F): a typed field reads a file when its value starts with @.
async function graphql(slug, query, vars = {}) {
	const [owner, name] = slug.split("/");
	const args = [
		"api",
		"graphql",
		"-f",
		`query=${query}`,
		"-f",
		`owner=${owner}`,
		"-f",
		`name=${name}`,
	];
	for (const [k, v] of Object.entries(vars)) if (v != null) args.push("-f", `${k}=${v}`);
	const out = JSON.parse(await gh(args));
	if (out.errors?.length) throw new Error(out.errors.map((e) => e.message).join("; "));
	return out.data;
}

const PRS = `query($owner:String!,$name:String!,$cursor:String){
 rateLimit{remaining limit resetAt}
 repository(owner:$owner,name:$name){
  defaultBranchRef{name}
  pullRequests(states:OPEN,first:30,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){
   pageInfo{hasNextPage endCursor}
   nodes{
    number title url body isDraft createdAt updatedAt additions deletions changedFiles
    author{login} headRefOid headRefName baseRefName mergeable canBeRebased
    files(first:100){nodes{path additions deletions changeType}}
    reviewThreads(first:100){totalCount nodes{isResolved}}
    reviews(last:50){nodes{author{login} state commit{oid}}}
    closingIssuesReferences(first:10){nodes{number repository{nameWithOwner}}}
    commits(last:1){nodes{commit{
     statusCheckRollup{contexts(first:100){nodes{__typename
      ...on StatusContext{context state}
      ...on CheckRun{name status conclusion checkSuite{workflowRun{workflow{name}}}}}}}
     checkSuites(first:50){nodes{status conclusion workflowRun{databaseId workflow{name}}}}
    }}}
   }}}}`;

const ISSUES = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
 issues(states:OPEN,first:100,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){
  pageInfo{hasNextPage endCursor}
  nodes{number title url createdAt updatedAt author{login} labels(first:10){nodes{name}} comments{totalCount}}
 }}}`;

const MERGED = `query($q:String!){search(query:$q,type:ISSUE,first:60){nodes{...on PullRequest{
 number title url mergedAt author{login} mergedBy{login}}}}}`;

// The default branch's recent commits, each with the PRs it came from: one from no merged PR was
// pushed straight to the branch (T092).
const PUSHES = `query($owner:String!,$name:String!,$since:GitTimestamp){repository(owner:$owner,name:$name){
 defaultBranchRef{target{...on Commit{history(first:30,since:$since){nodes{
  oid url committedDate messageHeadline author{name user{login}}
  associatedPullRequests(first:5){nodes{number merged}}}}}}}}}`;

export const pushesOf = (commits) =>
	commits
		.filter((c) => !c.associatedPullRequests.nodes.some((p) => p.merged))
		.map((c) => ({
			oid: c.oid,
			url: c.url,
			at: c.committedDate,
			headline: c.messageHeadline,
			author: c.author?.user?.login ?? c.author?.name ?? null,
		}));

// The server's merge, and the only one (T030): exactly the head it judged, or nothing. `admin` is the
// project's approval bypass (FR-029), passed only once the branch's rules were checked (bypassStops).
export const mergePr = ({ slug, n, method, head, admin = false }) =>
	gh([
		"pr",
		"merge",
		String(n),
		"--repo",
		slug,
		`--${method}`,
		"--match-head-commit",
		head,
		...(admin ? ["--admin"] : []),
	]);

// What the approval bypass needs to know before it merges, read only: the base branch's rules (its
// rulesets, and its classic protection when that is on), and every check run and status of the head.
const api = async (endpoint, jq) => (await gh(["api", "--paginate", endpoint, "--jq", jq])).trim();
const lines = (text) => (text ? text.split("\n").map((l) => JSON.parse(l)) : []);
export async function branchRules(slug, branch) {
	const b = encodeURIComponent(branch);
	return {
		rules: lines(await api(`repos/${slug}/rules/branches/${b}`, ".[]")),
		classic: JSON.parse(await api(`repos/${slug}/branches/${b}`, ".protection")),
	};
}
export async function headChecks(slug, sha) {
	return {
		runs: lines(
			await api(
				`repos/${slug}/commits/${sha}/check-runs?per_page=100`,
				".check_runs[] | {id, name, app: .app.id, status, conclusion}",
			),
		),
		statuses: lines(
			await api(`repos/${slug}/commits/${sha}/status`, ".statuses[] | {context, state}"),
		),
	};
}

// ── Normalizing, pure ─────────────────────────────────────────────────────────────────────────
const STATUS = {
	SUCCESS: "success",
	PENDING: "pending",
	EXPECTED: "pending",
	FAILURE: "failure",
	ERROR: "failure",
};
// Any other conclusion (failure, cancelled, timed out, stale, startup failure) is a failure.
const CONCLUSION = {
	SUCCESS: "success",
	NEUTRAL: "skipped",
	SKIPPED: "skipped",
	ACTION_REQUIRED: "waiting",
};
const runState = (c) =>
	c.status === "COMPLETED"
		? (CONCLUSION[c.conclusion] ?? "failure")
		: c.status === "WAITING"
			? "waiting"
			: "pending";

// Every check on the head commit: check runs (with their workflow) and commit statuses. A state is
// success, skipped (neutral too), pending, waiting (for an approval) or failure.
export const checksOf = (contexts) =>
	contexts.map((c) =>
		c.__typename === "StatusContext"
			? { name: c.context, workflow: null, state: STATUS[c.state] ?? "pending" }
			: {
					name: c.name,
					workflow: c.checkSuite?.workflowRun?.workflow?.name ?? null,
					state: runState(c),
				},
	);

// As FR-021 reads CI: no check is "none"; a head whose checks all succeeded or were skipped is green.
export function summarize(checks) {
	if (!checks.length) return "none";
	if (checks.some((c) => c.state === "failure")) return "failure";
	if (checks.some((c) => c.state === "pending" || c.state === "waiting")) return "pending";
	return "success";
}

// A fork's workflows that wait for a maintainer's approval have no check run yet, so the rollup can
// read green while they wait: their check suites are looked at first. `waiting` names those
// workflows, so a project's requiredChecks can tell its CI from a notification workflow.
export function ciOf(checks, suites) {
	const waiting = suites.filter(
		(s) => s.workflowRun && (s.status === "ACTION_REQUIRED" || s.conclusion === "ACTION_REQUIRED"),
	);
	const runIds = waiting.map((s) => s.workflowRun.databaseId);
	const names = [...new Set(waiting.map((s) => s.workflowRun.workflow?.name).filter(Boolean))];
	if (runIds.length) return { state: "action_required", runId: runIds[0], runIds, waiting: names };
	return { state: summarize(checks), runId: null, runIds: [], waiting: [] };
}

// The latest review of each reviewer on the head commit; a review of an older commit does not count.
export function reviewsOf(nodes, head) {
	const out = {};
	for (const r of nodes)
		if (r.author?.login && r.commit?.oid === head && r.state !== "PENDING")
			out[r.author.login] = r.state;
	return out;
}

// Issue numbers cited in a PR description (`Refs #12`, `Fixes #12`…), HTML comments aside.
export function bodyRefs(body) {
	const text = (body ?? "").replace(/<!--[\s\S]*?-->/g, "");
	const re =
		/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|refs?|part of|related(?: to)?|addresses)\b[\s:]*#(\d+)/gi;
	return [...new Set([...text.matchAll(re)].map((m) => Number(m[1])))];
}

export function normalizePr(slug, p) {
	const commit = p.commits.nodes[0]?.commit;
	const checks = checksOf(commit?.statusCheckRollup?.contexts?.nodes ?? []);
	const files = p.files.nodes.map((f) => ({
		path: f.path,
		additions: f.additions,
		deletions: f.deletions,
		change: f.changeType,
	}));
	const threads = p.reviewThreads;
	return {
		repo: slug,
		n: p.number,
		title: p.title,
		url: p.url,
		author: p.author?.login ?? null,
		draft: p.isDraft,
		head: p.headRefOid,
		headRef: p.headRefName,
		base: p.baseRefName,
		additions: p.additions,
		deletions: p.deletions,
		files,
		// More files than one page holds: the locks cannot see them all, so they refuse the PR.
		filesTruncated: p.changedFiles > files.length,
		refs: bodyRefs(p.body),
		// A `Closes owner/fork#4` resolves to the fork: only this repo's issues count.
		closes: p.closingIssuesReferences.nodes
			.filter((i) => i.repository?.nameWithOwner === slug)
			.map((i) => i.number),
		mergeable: p.mergeable,
		canBeRebased: p.canBeRebased,
		ci: ciOf(checks, commit?.checkSuites?.nodes ?? []),
		checks,
		reviews: reviewsOf(p.reviews.nodes, p.headRefOid),
		// Threads beyond the first page are counted as open: unseen is not resolved.
		threadsOpen:
			threads.nodes.filter((t) => !t.isResolved).length +
			(threads.totalCount - threads.nodes.length),
		createdAt: p.createdAt,
		updatedAt: p.updatedAt,
	};
}

export const normalizeIssue = (slug, i) => ({
	repo: slug,
	n: i.number,
	title: i.title,
	url: i.url,
	author: i.author?.login ?? null,
	labels: i.labels.nodes.map((l) => l.name),
	comments: i.comments.totalCount,
	createdAt: i.createdAt,
	updatedAt: i.updatedAt,
});

// ── Reading ───────────────────────────────────────────────────────────────────────────────────
async function paginate(slug, query, pick) {
	const all = [];
	let first = null;
	let cursor = null;
	do {
		const data = await graphql(slug, query, { cursor });
		first ??= data;
		const page = pick(data);
		all.push(...page.nodes);
		cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
	} while (cursor);
	return { all, first };
}

export async function fetchRepo(slug) {
	const week = new Date(Date.now() - 7 * 86400e3).toISOString();
	const [prs, issues, merged, pushes] = await Promise.all([
		paginate(slug, PRS, (d) => d.repository.pullRequests),
		paginate(slug, ISSUES, (d) => d.repository.issues),
		graphql(slug, MERGED, { q: `repo:${slug} is:pr is:merged merged:>=${week.slice(0, 10)}` }),
		graphql(slug, PUSHES, { since: week }),
	]);
	return {
		defaultBranch: prs.first.repository.defaultBranchRef?.name ?? null,
		pushes: pushesOf(pushes.repository.defaultBranchRef?.target?.history?.nodes ?? []),
		prs: prs.all.map((p) => normalizePr(slug, p)).sort((a, b) => b.n - a.n),
		issues: issues.all.map((i) => normalizeIssue(slug, i)).sort((a, b) => b.n - a.n),
		merged: merged.search.nodes
			.filter((p) => p.number)
			.map((p) => ({
				repo: slug,
				n: p.number,
				title: p.title,
				url: p.url,
				author: p.author?.login ?? null,
				mergedBy: p.mergedBy?.login ?? null,
				mergedAt: p.mergedAt,
			}))
			.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1)),
		rate: prs.first.rateLimit,
	};
}

// ── Polling, per project (T010) ───────────────────────────────────────────────────────────────
const hash = (v) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex");
const firstLine = (e) =>
	String(e?.stderr || e?.message || e)
		.trim()
		.split("\n")[0];

// One read of every repo of a project. A repo that fails keeps its last good state, with the error.
export async function readProject(project, prev = null, fetch = fetchRepo) {
	const now = new Date().toISOString();
	const repos = {};
	let rate = null;
	await Promise.all(
		project.repos.map(async ({ slug }) => {
			const old = prev?.repos?.[slug] ?? {};
			try {
				const { rate: r, ...data } = await fetch(slug);
				if (r && (!rate || r.remaining < rate.remaining)) rate = r;
				const same =
					hash([old.prs, old.issues, old.merged]) === hash([data.prs, data.issues, data.merged]);
				repos[slug] = {
					...data,
					checkedAt: now,
					changedAt: same && old.changedAt ? old.changedAt : now,
					error: null,
				};
			} catch (e) {
				repos[slug] = { ...old, error: firstLine(e), errorAt: now };
			}
		}),
	);
	return { checkedAt: now, repos, rate };
}

// ponytail: four times slower under 20 % of the GraphQL budget; spread the budget until its reset if
// one instance ever polls enough repos to exhaust it anyway.
export const nextDelay = (refreshSec, rate) =>
	refreshSec * 1000 * (rate && rate.remaining < rate.limit * 0.2 ? 4 : 1);

// Reads a project now, then every refreshSec. `refresh()` reads again at once; a read never overlaps
// another one.
export function poll(project, onLive, { initial = null, read = readProject } = {}) {
	let live = initial;
	let timer = null;
	let running = false;
	let again = false;
	let stopped = false;
	const cycle = async () => {
		if (running) {
			again = true;
			return;
		}
		running = true;
		clearTimeout(timer);
		try {
			live = await read(project, live);
			await onLive(live);
		} catch (e) {
			await onLive(live, e);
		} finally {
			running = false;
			if (again && !stopped) {
				again = false;
				cycle();
			} else if (!stopped) timer = setTimeout(cycle, nextDelay(project.refreshSec, live?.rate));
		}
	};
	cycle();
	return {
		refresh: cycle,
		isRunning: () => running,
		stop: () => {
			stopped = true;
			clearTimeout(timer);
		},
	};
}
