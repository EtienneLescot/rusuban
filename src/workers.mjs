// Workers: long work (a fix, a proof, a rebase) in its own headless run and its own git worktree of
// Rusuban's clone of the repo, never in a person's checkout (research R11). At most
// `limits.maxWorkers` wait or run at once, on every project of the instance; each one's final answer
// becomes a report for the coordinator (src/agents.mjs).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listRuns, requestRun, stopRun } from "./agents.mjs";
import { homePath } from "./home.mjs";

const NAME = /^[a-z0-9][a-z0-9-]{2,39}$/;
const git = (args, cwd) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
export const cloneOf = (slug) => homePath(`repos/${slug}`);
export const worktreeOf = (project, run) => homePath(`worktrees/${project}/${run}`);
const active = (r) => r.kind === "worker" && ["queued", "running"].includes(r.state);

// Workers starting together would clone or fetch the same repo at once, and git's own locks make all
// but one fail: one worker at a time prepares a clone. A lock older than 10 minutes is a dead one's.
function withCloneLock(slug, fn) {
	const lock = `${cloneOf(slug)}.lock`;
	fs.mkdirSync(path.dirname(lock), { recursive: true });
	const until = Date.now() + 600_000;
	for (;;) {
		try {
			fs.mkdirSync(lock);
			break;
		} catch {
			if (Date.now() > until) fs.rmSync(lock, { recursive: true, force: true });
			else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
		}
	}
	try {
		return fn();
	} finally {
		fs.rmSync(lock, { recursive: true, force: true });
	}
}

// A worker's folder: a detached worktree on the default branch of Rusuban's own clone of the repo,
// made on first use (partial: blobs come on demand) and fetched each time.
export function prepareWorktree({ slug, branch, project, run }) {
	if (!slug || !branch) throw new Error(`no default branch known for ${slug}: read GitHub first`);
	const clone = cloneOf(slug);
	const dir = worktreeOf(project, run);
	return withCloneLock(slug, () => {
		if (!fs.existsSync(path.join(clone, ".git")))
			execFileSync(
				"gh",
				["repo", "clone", slug, clone, "--", "--filter=blob:none", "--no-checkout"],
				{ stdio: "ignore", windowsHide: true },
			);
		git(["fetch", "--prune", "origin"], clone);
		fs.mkdirSync(path.dirname(dir), { recursive: true });
		git(["worktree", "add", "--detach", dir, `origin/${branch}`], clone);
		return dir;
	});
}

const prune = (slug) => {
	if (slug && fs.existsSync(cloneOf(slug)))
		try {
			git(["worktree", "prune"], cloneOf(slug));
		} catch {}
};

// fs.rmSync unlinks a symlink or a junction without following it, where `git worktree remove
// --force` would empty the folder a junction points to; prune then drops git's record of it.
export function removeWorktree(dir, slug) {
	fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	prune(slug);
}

// Worktrees whose run no longer waits or works (a crash, a reboot), removed when the daemon starts.
export function cleanStale(project, slugs = []) {
	let dirs = [];
	try {
		dirs = fs.readdirSync(homePath(`worktrees/${project}`));
	} catch {
		return [];
	}
	const runs = new Map(listRuns(project).map((r) => [r.id, r]));
	const stale = dirs.filter((d) => !["queued", "running"].includes(runs.get(d)?.state));
	for (const d of stale) fs.rmSync(worktreeOf(project, d), { recursive: true, force: true });
	for (const slug of slugs) prune(slug);
	return stale;
}

export function startWorker({ config, project, name, item, mission }) {
	if (!NAME.test(name ?? ""))
		throw new Error("a worker's name is 3 to 40 lowercase letters, digits, dashes");
	if (!mission?.trim()) throw new Error("the mission is empty");
	const live = listRuns().filter(active);
	if (live.some((r) => r.project === project && r.title === name))
		throw new Error(`worker ${name} is already at work`);
	if (live.some((r) => r.project === project && r.items.includes(item)))
		throw new Error(`a worker is already at work on ${item}`);
	if (live.length >= config.limits.maxWorkers)
		throw new Error(
			`${live.length} workers are at work (limit ${config.limits.maxWorkers}): start this one when one ends`,
		);
	return requestRun({
		kind: "worker",
		project,
		mission,
		items: [item],
		lock: `${project}.worker.${name}`,
		trigger: "coordinator",
		title: name,
	});
}

export const listWorkers = (project) =>
	listRuns(project)
		.filter((r) => r.kind === "worker")
		.map(({ id, title, items, state, step, startedAt, endedAt, summary, session }) => ({
			name: title,
			item: items[0],
			run: id,
			state,
			step,
			startedAt,
			endedAt,
			summary,
			session,
		}));

export function stopWorker(project, name) {
	const r = listRuns(project).find((x) => active(x) && x.title === name);
	if (!r) throw new Error(`no worker ${name} at work`);
	return stopRun(r.id, "Stopped by the coordinator.");
}
