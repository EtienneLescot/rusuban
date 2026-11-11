// Workers: long work (a fix, a proof, a rebase) in its own headless run and its own git worktree of
// Rusuban's clone of the repo, never in a person's checkout (research R11). At most
// `limits.maxWorkers` work at once, on every project of the instance; one started past the limit
// waits its turn (src/agents.mjs). Each one's final answer becomes a report for the coordinator.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listRuns, requestRun, stopRun } from "./agents.mjs";
import { homeDir, homePath } from "./home.mjs";

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
const waitsOrWorks = (r) => ["queued", "running"].includes(r.state);
const active = (r) => r.kind === "worker" && waitsOrWorks(r);

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

// fs.rm unlinks a symlink or a junction without following it, where `git worktree remove --force`
// would empty the folder a junction points to; prune then drops git's record of it.
const remove = (dir) => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3 });

// ── What a worker opens, and its removal (FR-103) ────────────────────────────────────────────────
// A worker works in its worktree, and anything else (builds, exports, temporary files, another
// worktree of the clone) goes in its work folder, `<workRoot>/<run>`, and in WSL under
// `~/rusuban-work/<run>`. Both are given to the run and removed with it, as its worktree is.
export const workRootOf = (config) => config.workRoot ?? homePath("work");
export const workDirOf = (run, config) => path.join(workRootOf(config), run);
export const WSL_WORK = "rusuban-work";
const RUN_ID = /^[a-z]+-\d{14}-[0-9a-f]{4}$/;

// A shell in WSL: what it printed, or null where there is none. Replaceable in tests.
// ponytail: it starts WSL when it was not running, at a worker's end and in each sweep.
export const wsl = {
	run: (script) =>
		new Promise((resolve) =>
			execFile("wsl.exe", ["-e", "sh", "-c", script], { windowsHide: true }, (e, out) =>
				resolve(e ? null : out),
			),
		),
};
// Names are run ids, checked: nothing in them for the shell to read.
const wslRemove = (names) =>
	wsl.run(`cd "$HOME/${WSL_WORK}" 2>/dev/null && rm -rf -- ${names.join(" ")}`);

// Removes what one run opened. Never a live run's: the callers have ended or stopped it.
export async function releaseFiles(run) {
	if (!run.worktree && !run.workDir && !run.wslWork) return;
	for (const dir of [run.worktree, run.workDir]) if (dir) await remove(dir).catch(() => {});
	prune(run.items?.[0]?.split("#")[0]);
	if (run.wslWork && RUN_ID.test(run.id)) await wslRemove([run.id]);
}

// The worktrees git knows in a clone, its own folder aside: git lists it first, by its real path,
// which is not the one Rusuban knows where a link leads to it (macOS's /var is /private/var).
function registered(clone) {
	try {
		return git(["worktree", "list", "--porcelain"], clone)
			.split("\n")
			.filter((l) => l.startsWith("worktree "))
			.slice(1)
			.map((l) => path.resolve(l.slice("worktree ".length)));
	} catch {
		return [];
	}
}
// Paths compared as the file system finds them: through links, and without case on Windows.
const norm = (p) => {
	let r = path.resolve(p);
	try {
		r = fs.realpathSync.native(r);
	} catch {}
	return process.platform === "win32" ? r.toLowerCase() : r;
};
const inside = (p, dir) =>
	!!dir && (norm(p) === norm(dir) || norm(p).startsWith(norm(dir) + path.sep));
const dirNames = (dir) => {
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		return [];
	}
};

// The sweep, at the daemon's start and once a day (FR-103): what runs that no longer wait nor work
// left behind. Their folders, those their status names and those named after them in the work root
// and in WSL: only this instance's own runs, another instance may share those. Every worktree
// folder nobody works in. A worktree of a clone outside every run's folders is someone's only while
// a worker or a task lives: it goes once none does. Resolves with what went, and what it freed on
// the disk, by project; WSL frees nothing there.
export async function sweep(config) {
	const gone = new Map();
	const count = (project, what, bytes) => {
		const g = gone.get(project) ?? { folders: [], bytes: 0 };
		g.folders.push(what);
		g.bytes += bytes;
		gone.set(project, g);
	};
	const free = (dir) => {
		try {
			return disk.free(dir);
		} catch {
			return 0;
		}
	};
	const drop = async (project, dir) => {
		const before = free(dir);
		await remove(dir).catch(() => {});
		count(project, dir, Math.max(0, free(dir) - before));
	};
	// A run that ends stays ended (a retry is another run): only the live ones are read again.
	const runs = listRuns();
	const ended = new Map(runs.filter((r) => !waitsOrWorks(r)).map((r) => [r.id, r]));
	const alive = () => listRuns().filter(waitsOrWorks);
	for (const r of ended.values())
		for (const dir of [r.worktree, r.workDir])
			if (dir && fs.existsSync(dir)) await drop(r.project, dir);
	const root = workRootOf(config);
	for (const name of dirNames(root))
		if (ended.has(name)) await drop(ended.get(name).project, path.join(root, name));
	for (const p of config.projects)
		for (const name of dirNames(homePath(`worktrees/${p.id}`)))
			if (!alive().some((r) => r.id === name)) await drop(p.id, worktreeOf(p.id, name));
	if (runs.some((r) => r.wslWork && ended.has(r.id))) {
		const there = (await wsl.run(`ls -1 "$HOME/${WSL_WORK}" 2>/dev/null`)) ?? "";
		const names = there.split(/\s+/).filter((n) => RUN_ID.test(n) && ended.has(n));
		if (names.length) {
			await wslRemove(names);
			for (const n of names) count(ended.get(n).project, `WSL ~/${WSL_WORK}/${n}`, 0);
		}
	}
	for (const p of config.projects)
		for (const { slug } of p.repos) {
			const clone = cloneOf(slug);
			if (!fs.existsSync(clone)) continue;
			for (const wt of registered(clone)) {
				// Never a folder holding the clone or Rusuban's home, whatever git says.
				if (inside(clone, wt) || inside(homeDir(), wt)) continue;
				const now = alive();
				if (now.some((r) => inside(wt, r.worktree) || inside(wt, r.workDir))) continue;
				const own = [...ended.values()].find(
					(r) => inside(wt, r.worktree) || inside(wt, r.workDir),
				);
				// Made outside the work folders, as before them: maybe a live worker's, or a task's.
				if (!own && now.some((r) => r.kind === "worker" || r.kind === "task")) continue;
				if (fs.existsSync(wt)) await drop(own?.project ?? p.id, wt);
			}
			prune(slug);
		}
	return gone;
}

// ── Room on the disks (FR-103) ──────────────────────────────────────────────────────────────────
// A worker starts only with room for its worktree and its work folder: below this, it waits in its
// queue, the reason in its status. Replaceable in tests.
// ponytail: one threshold for every instance; a setting if a small disk needs another.
export const MIN_FREE_GB = 10;
export const ROOM = "Waits for room";
export const disk = {
	free: (dir) => {
		let at = path.resolve(dir);
		while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
		const s = fs.statfsSync(at);
		return s.bavail * s.bsize;
	},
};
// The first disk short of room for a worker, as the reason it waits, or null. A disk that cannot be
// read (a drive unplugged) has none.
export function lowOnRoom(config) {
	for (const dir of [homePath("worktrees"), workRootOf(config)]) {
		const root = path.parse(path.resolve(dir)).root;
		let gb;
		try {
			gb = disk.free(dir) / 1e9;
		} catch {
			return `${ROOM}: ${root} cannot be read`;
		}
		if (gb < MIN_FREE_GB)
			return `${ROOM}: ${gb.toFixed(1)} GB free on ${root}, ${MIN_FREE_GB} GB needed`;
	}
	return null;
}

export function startWorker({ project, name, item, mission }) {
	if (!NAME.test(name ?? ""))
		throw new Error("a worker's name is 3 to 40 lowercase letters, digits, dashes");
	if (!mission?.trim()) throw new Error("the mission is empty");
	const live = listRuns().filter(active);
	if (live.some((r) => r.project === project && r.title === name))
		throw new Error(`worker ${name} is already at work`);
	if (live.some((r) => r.project === project && r.items.includes(item)))
		throw new Error(`a worker is already at work on ${item}`);
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
