// The conversations hub (US4, research R6): every Claude Code session held in a project's folders,
// read from Claude Code's own transcripts, `<claude>/projects/<slug>/<session>.jsonl`. The slug only
// says where to look: a session belongs to a project by its `cwd` or `relocatedCwd`, never by its
// folder, because sibling folders share a slug (`repo-site` and `repo/site`). Each file is read on
// from the byte where the last pass stopped. The format is Claude Code's own and may change: a line
// of an unknown type is skipped, an unreadable one counted, and a file in an unknown format is still
// listed, plainly.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listRuns, NO_MODEL, readRun, requestRun } from "./agents.mjs";
import { MODEL, read, write } from "./home.mjs";
import { flatten, keyOf } from "./model.mjs";

const INDEX = "hub/index.json";
const VERSION = 2; // an index of another version is read again from scratch
const LIVE_MS = 120_000; // a transcript written in the last two minutes is a live session
const CHUNK = 1 << 20; // read 1 MB at a time: a transcript can pass 100 MB
const RESULT_MAX = 2048; // a tool result is cut to 2 KB in a page

const claudeProjects = () =>
	path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");

// ── Folders ───────────────────────────────────────────────────────────────────────────────────
// Paths compare without case where the file system ignores it (Windows, and macOS by default).
const fold = (s) =>
	process.platform === "win32" || process.platform === "darwin" ? s.toLowerCase() : s;
const norm = (p) => fold(path.resolve(p));
// Claude Code names a session's folder after the folder it started in: every character but a letter
// or a digit becomes "-".
export const slugOf = (p) => path.resolve(p).replace(/[^a-zA-Z0-9]/g, "-");
// Both paths normalized: a string test, as it runs for every session against every folder.
const inside = (dir, p) =>
	p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`);
const dirents = (dir) => {
	try {
		return fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
};

// A checkout's worktrees, wherever git put them: each `.git/worktrees/<name>/gitdir` names the
// worktree's own `.git`.
const worktreesOf = (checkout) =>
	dirents(path.join(checkout, ".git", "worktrees")).flatMap((d) => {
		try {
			const gitdir = path.join(checkout, ".git", "worktrees", d.name, "gitdir");
			return [path.dirname(fs.readFileSync(gitdir, "utf8").trim())];
		} catch {
			return [];
		}
	});

// Every project's folders: its checkouts and their worktrees, which give a bare `#N` its repo, and
// its extra folders.
const foldersOf = (config) =>
	config.projects
		.flatMap((p) => [
			...p.repos
				.filter((r) => r.checkout)
				.flatMap((r) =>
					[r.checkout, ...worktreesOf(r.checkout)].map((dir) => ({
						project: p.id,
						repo: r.slug,
						dir,
					})),
				),
			...p.folders.map((dir) => ({ project: p.id, repo: null, dir })),
		])
		.map((f) => ({ ...f, dir: norm(f.dir), slug: fold(slugOf(f.dir)) }));

// ── Reading a transcript ──────────────────────────────────────────────────────────────────────
// Whole lines from byte `from` to byte `to`, decoded one by one so a character split across two
// chunks stays whole. A line not yet whole is left for the next pass: resolves with its offset.
async function eachLine(file, from, to, onLine) {
	const fh = await fs.promises.open(file, "r");
	let base = from; // the file offset of buf[0]
	let buf = Buffer.alloc(0);
	try {
		for (let pos = from; pos < to; ) {
			const chunk = Buffer.alloc(Math.min(CHUNK, to - pos));
			const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
			if (!bytesRead) break;
			pos += bytesRead;
			buf = Buffer.concat([buf, chunk.subarray(0, bytesRead)]);
			let start = 0;
			let nl = buf.indexOf(10);
			while (nl !== -1) {
				onLine(buf.toString("utf8", start, nl));
				start = nl + 1;
				nl = buf.indexOf(10, start);
			}
			buf = buf.subarray(start);
			base += start;
		}
	} finally {
		await fh.close();
	}
	return base;
}

// The lines ending at or before byte `end`, newest first, each with the offset where it starts.
// Blank lines are skipped.
async function* linesBefore(file, end) {
	const fh = await fs.promises.open(file, "r");
	try {
		let pos = end;
		let rest = Buffer.alloc(0); // bytes [pos, pos + rest.length): a line whose start is not read yet
		while (pos > 0) {
			const n = Math.min(CHUNK, pos);
			pos -= n;
			const chunk = Buffer.alloc(n);
			await fh.read(chunk, 0, n, pos);
			rest = Buffer.concat([chunk, rest]);
			let stop = rest.length;
			let nl = rest.lastIndexOf(10, stop - 1);
			while (stop > 0 && nl !== -1) {
				if (stop > nl + 1) yield [rest.toString("utf8", nl + 1, stop), pos + nl + 1];
				stop = nl;
				nl = stop > 0 ? rest.lastIndexOf(10, stop - 1) : -1;
			}
			rest = rest.subarray(0, stop);
		}
		if (rest.length) yield [rest.toString("utf8"), 0];
	} finally {
		await fh.close();
	}
}

const str = (v) => (typeof v === "string" && v ? v : null);
const add = (list, v) => {
	if (!list.includes(v)) list.push(v);
};
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
// What a person wrote: the reminders Claude Code adds to a message (memory, git status) are not theirs.
const humanText = (t) => (typeof t === "string" ? t.replace(REMINDER, "").trim() : "");
const partsOf = (message) => {
	const c = message?.content;
	return typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
};

const ITEM_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)/g;
const FULL_REF = /\b([\w.-]+\/[\w.-]+)#(\d+)\b/g;
const BARE_REF = /(?<![\w&/])#(\d{1,7})\b/g;
const BRANCH_NUMBER = /(?<=^|[/_-])\d{1,7}(?=$|[/_-])/g; // fix/1475-keyframes, not v2.0.1

// The GitHub links and the numbers a person cited, in a message or a title.
function cite(s, text) {
	for (const m of text.matchAll(ITEM_URL)) add(s.refs, `${m[1]}#${Number(m[2])}`);
	for (const m of text.matchAll(FULL_REF)) add(s.refs, `${m[1]}#${Number(m[2])}`);
	for (const m of text.matchAll(BARE_REF)) add(s.cited, Number(m[1]));
}

// A session's title: its custom title, else its agent name, else the title Claude Code wrote for it,
// else the start of its first message.
const RANK = { user: 0, "ai-title": 1, "agent-name": 2, "custom-title": 3 };
function retitle(s, text, from) {
	const t = humanText(text)
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 100);
	if (!t || (from === "user" ? s.title : RANK[from] < (RANK[s.titleFrom] ?? -1))) return;
	s.title = t;
	s.titleFrom = from;
}

const fresh = (id, file) => ({
	id,
	file,
	project: null,
	run: null,
	origin: null,
	title: null,
	titleFrom: null,
	cwd: null,
	cwds: [],
	entrypoint: null,
	firstAt: null,
	lastAt: null,
	live: false,
	branch: null,
	branches: [],
	prs: [],
	cited: [],
	refs: [],
	heads: [],
	items: [],
	badLines: 0,
	parseError: null,
});

// One line into its session.
function take(s, line) {
	if (!line.trim()) return;
	let o;
	try {
		o = JSON.parse(line);
	} catch {
		s.badLines++;
		return;
	}
	if (!o || typeof o !== "object") return;
	const at = str(o.timestamp);
	if (at && (!s.firstAt || at < s.firstAt)) s.firstAt = at;
	if (at && (!s.lastAt || at > s.lastAt)) s.lastAt = at;
	const cwd = str(o.relocatedCwd) ?? str(o.cwd);
	if (cwd) {
		s.cwd = cwd;
		add(s.cwds, cwd);
	}
	const branch = str(o.gitBranch);
	if (branch) {
		s.branch = branch;
		add(s.branches, branch);
	}
	s.entrypoint ??= str(o.entrypoint);
	const title = {
		"custom-title": o.customTitle,
		"agent-name": o.agentName,
		"ai-title": o.aiTitle,
	}[o.type];
	if (str(title)) {
		retitle(s, title, o.type);
		if (o.type !== "ai-title") cite(s, title); // a title Claude wrote is not a person's citation
	}
	const repo = str(o.prRepository);
	if (o.type === "pr-link" && repo && Number.isInteger(o.prNumber))
		if (!s.prs.some((p) => p.repo === repo && p.n === o.prNumber))
			s.prs.push({ repo, n: o.prNumber, url: str(o.prUrl) });
	// A compaction's summary is Claude's own text: neither the person's words nor their citations.
	if (o.type === "user" && !o.isMeta && !o.isSidechain && !o.isCompactSummary)
		for (const p of partsOf(o.message)) {
			const text = p?.type === "text" && humanText(p.text);
			if (!text) continue;
			retitle(s, text, "user");
			cite(s, text);
		}
}

// ── Links ─────────────────────────────────────────────────────────────────────────────────────
// What each project's live state offers: its repos by lower-case name, the items it knows, and its
// open PRs by head branch, except a PR from a fork's default branch, or every session on `main`
// would be about it.
function projectsOf(config) {
	const out = new Map();
	for (const p of config.projects) {
		const known = new Set();
		const heads = new Map();
		for (const r of Object.values(read(`projects/${p.id}/live.json`, {}).repos ?? {})) {
			for (const it of [...(r.prs ?? []), ...(r.issues ?? []), ...(r.merged ?? [])])
				known.add(keyOf(it));
			for (const pr of r.prs ?? [])
				if (pr.headRef && pr.headRef !== r.defaultBranch) heads.set(pr.headRef, keyOf(pr));
		}
		out.set(p.id, {
			repos: new Map(p.repos.map((r) => [r.slug.toLowerCase(), r.slug])),
			known,
			heads,
		});
	}
	return out;
}

// The items a session is about, in the order of R6: the runs that started it, the PRs Claude Code
// recorded, the PRs whose head branch it worked on, then what a person cited: GitHub links, and the
// numbers in its branch names and messages when they name an item the project knows. A run's own
// first message is its assembled prompt, which cites every open card: it counts for nothing. A head
// found is kept in `heads`, so a session stays linked to its PR once the PR leaves the open list.
function linksOf(s, runs, live, repo) {
	const items = [];
	const addRef = (ref) => {
		const i = ref.lastIndexOf("#");
		const slug = live.repos.get(ref.slice(0, i).toLowerCase());
		if (slug) add(items, `${slug}#${ref.slice(i + 1)}`);
	};
	for (const r of runs) for (const k of r.items ?? []) add(items, k);
	for (const pr of s.prs) addRef(`${pr.repo}#${pr.n}`);
	for (const b of s.branches) if (live.heads.has(b)) add(s.heads, live.heads.get(b));
	for (const k of s.heads) add(items, k);
	if (runs.length) return items;
	for (const ref of s.refs) addRef(ref);
	const numbers = [...s.branches.flatMap((b) => b.match(BRANCH_NUMBER) ?? []), ...s.cited];
	for (const n of numbers)
		if (repo && live.known.has(`${repo}#${Number(n)}`)) add(items, `${repo}#${Number(n)}`);
	return items;
}

// ── One pass ──────────────────────────────────────────────────────────────────────────────────
// Finds the transcripts in the folders named after the projects' folders and Rusuban's own runs,
// reads what each file gained since the last pass, then places and links every session. Writes and
// returns the index (`hub/index.json`, written by the daemon only). `root` and `runs` are injectable.
export async function scanHub({
	config,
	root = claudeProjects(),
	runs = listRuns(),
	now = Date.now(),
}) {
	const old = read(INDEX, null);
	const prev = old?.version === VERSION ? old : { sessions: {}, files: {} };
	const folders = foldersOf(config);
	const runsOf = new Map(); // session → the runs that worked in it, newest first
	for (const r of runs) if (r.session) runsOf.set(r.session, [...(runsOf.get(r.session) ?? []), r]);
	const runSlugs = new Set(runs.filter((r) => r.session && r.cwd).map((r) => fold(slugOf(r.cwd))));
	const wanted = (name) => {
		const n = fold(name);
		return runSlugs.has(n) || folders.some((f) => n === f.slug || n.startsWith(`${f.slug}-`));
	};

	// One file per session, the newest: Claude Code copies a transcript when it moves a session.
	const found = new Map();
	const consider = (file) => {
		let st;
		try {
			st = fs.statSync(file);
		} catch {
			return;
		}
		const id = path.basename(file, ".jsonl");
		const had = found.get(id);
		if (!had || st.mtimeMs > had.mtime || (st.mtimeMs === had.mtime && st.size > had.size))
			found.set(id, { file, size: st.size, mtime: st.mtimeMs });
	};
	for (const d of dirents(root))
		if (d.isDirectory() && wanted(d.name))
			for (const f of dirents(path.join(root, d.name)))
				if (f.isFile() && f.name.endsWith(".jsonl")) consider(path.join(root, d.name, f.name));
	for (const file of Object.keys(prev.files)) consider(file); // a session stays while its file does

	const sessions = {};
	const files = {};
	for (const [id, f] of found) {
		let s = prev.sessions[id];
		let offset = prev.files[f.file]?.offset ?? 0;
		if (s?.file !== f.file || f.size < offset) {
			s = fresh(id, f.file); // a new session, another copy of it, or a file written over
			offset = 0;
		}
		if (f.size > offset) offset = await eachLine(f.file, offset, f.size, (line) => take(s, line));
		s.live = now - f.mtime < LIVE_MS;
		if (!s.firstAt) s.lastAt = new Date(f.mtime).toISOString(); // no timestamp read
		sessions[id] = s;
		files[f.file] = { size: f.size, offset, mtime: f.mtime };
	}

	// A session belongs to the project of the run that started it, else of the deepest folder that
	// holds one of its folders, else stays where it was (a worktree since removed). A file in an
	// unknown format has no folder to read: its own folder's slug places it, plainly.
	const projects = projectsOf(config);
	for (const s of Object.values(sessions)) {
		const rs = runsOf.get(s.id) ?? [];
		const cwds = s.cwds.map(norm);
		const slug = fold(path.basename(path.dirname(s.file)));
		const home = folders
			.filter((f) => (cwds.length ? cwds.some((c) => inside(f.dir, c)) : f.slug === slug))
			.sort((a, b) => b.dir.length - a.dir.length)[0];
		s.project = [rs[0]?.project, home?.project, s.project].find((p) => projects.has(p)) ?? null;
		const p = config.projects.find((x) => x.id === s.project);
		const repo =
			(home?.project === s.project && home.repo) ||
			(p?.repos.length === 1 ? p.repos[0].slug : null);
		s.run = rs[0]?.id ?? null;
		s.origin = rs.length ? "rusuban" : s.entrypoint;
		s.items = p ? linksOf(s, rs, projects.get(p.id), repo) : [];
		s.parseError = !s.cwds.length
			? "unknown format"
			: s.badLines
				? `${s.badLines} unreadable line${s.badLines > 1 ? "s" : ""}`
				: null;
	}
	const index = { version: VERSION, scannedAt: new Date(now).toISOString(), sessions, files };
	write(INDEX, index);
	return index;
}

// ── What the dashboard reads ──────────────────────────────────────────────────────────────────
const view = (s) => ({
	id: s.id,
	project: s.project,
	cwd: s.cwd,
	title: s.title,
	origin: s.origin,
	run: s.run,
	firstAt: s.firstAt,
	lastAt: s.lastAt,
	live: s.live,
	branch: s.branch,
	prs: s.prs,
	items: s.items,
	parseError: s.parseError,
});

// The conversations of `/api/conversations?project=&item=&q=`, newest activity first.
export function listConversations(index, { project = null, item = null, q = "" } = {}) {
	const needle = String(q ?? "")
		.trim()
		.toLowerCase();
	return Object.values(index?.sessions ?? {})
		.filter(
			(s) =>
				s.project &&
				(!project || s.project === project) &&
				(!item || s.items.includes(item)) &&
				(!needle || `${s.title ?? ""} ${s.branch ?? ""} ${s.id}`.toLowerCase().includes(needle)),
		)
		.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
		.map(view);
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const shortInput = (i) => {
	const v = i.command ?? i.description ?? i.file_path ?? i.pattern ?? i.prompt ?? i.url ?? i;
	return cut(typeof v === "string" ? v : JSON.stringify(v), 160);
};
const resultText = (c) =>
	typeof c === "string"
		? c
		: Array.isArray(c)
			? c
					.filter((p) => p?.type === "text")
					.map((p) => p.text)
					.join("\n")
			: "";

// What one line shows in the reader: a person's text, Claude's text, its tool calls with a short
// input, their results cut to 2 KB. Injected messages, subagents' lines and a compaction's summary
// show nothing.
function entriesOf(line) {
	let o;
	try {
		o = JSON.parse(line);
	} catch {
		return [];
	}
	if (!o || typeof o !== "object" || o.isMeta || o.isSidechain || o.isCompactSummary) return [];
	const at = str(o.timestamp);
	const out = [];
	for (const p of partsOf(o.message)) {
		if (o.type === "user" && p?.type === "text" && humanText(p.text))
			out.push({ kind: "user", at, text: humanText(p.text) });
		if (o.type === "user" && p?.type === "tool_result")
			out.push({
				kind: "result",
				at,
				text: cut(resultText(p.content), RESULT_MAX),
				error: p.is_error === true,
			});
		if (o.type === "assistant" && p?.type === "text" && str(p.text?.trim()))
			out.push({ kind: "assistant", at, text: p.text });
		if (o.type === "assistant" && p?.type === "tool_use")
			out.push({ kind: "tool", at, name: p.name, input: shortInput(p.input ?? {}) });
	}
	return out;
}

// One page of `/api/conversations/<id>?before=<offset>`: the last `limit` entries or so before that
// byte (the end of the file without it), oldest first, and the offset to ask for the page before
// it, null once the page reaches the start. Null for a session that is not a project's, or an offset
// past the end.
export async function readPage(index, id, { before = null, limit = 50 } = {}) {
	const s = index?.sessions?.[id];
	if (!s?.project) return null;
	let size;
	try {
		size = (await fs.promises.stat(s.file)).size;
	} catch {
		return null;
	}
	const end = before == null ? size : Number(before);
	if (!Number.isInteger(end) || end < 0 || end > size) return null;
	const max = Math.max(1, limit);
	const entries = [];
	let start = end;
	let more = false; // a line is left before the page
	for await (const [line, at] of linesBefore(s.file, end)) {
		if (entries.length >= max) {
			more = true;
			break;
		}
		entries.unshift(...entriesOf(line));
		start = at;
	}
	return { id, before: more ? start : null, entries };
}

// The index the last pass wrote, for the daemon to show at start while its first pass reads.
export const lastIndex = () => {
	const index = read(INDEX, null);
	return index?.version === VERSION ? index : null;
};

// ── The Conversations view (T061) ─────────────────────────────────────────────────────────────
const ORIGIN = { "claude-desktop": "desktop", cli: "terminal" };

// `listConversations`, with each session's origin as the page names it, its run, and the type and
// title of each item the projects know, for the list's headings. A run's session shows the run's
// title: its first message is the assembled prompt. A fork is listed under the session it came from.
export function hubState(index, config, { origin = null, ...filters } = {}) {
	const runs = new Map(listRuns().map((r) => [r.id, r]));
	const items = {};
	for (const p of config.projects) {
		const { prs, issues } = flatten(read(`projects/${p.id}/live.json`, {}));
		for (const i of prs) items[keyOf(i)] = { type: "pr", title: i.title };
		for (const i of issues) items[keyOf(i)] = { type: "issue", title: i.title };
	}
	const conversations = listConversations(index, filters)
		.map((c) => {
			const run = c.run ? runs.get(c.run) : null;
			return {
				...c,
				title: run?.title ?? c.title ?? "Untitled",
				origin: ORIGIN[c.origin] ?? c.origin ?? "unknown",
				runKind: run?.kind ?? null,
				runState: run?.state ?? null,
				forkOf: run?.forkOf ?? null,
			};
		})
		.filter((c) => !origin || c.origin === origin);
	return { indexedAt: index?.scannedAt ?? null, items, conversations };
}

const sessionIn = (index, id) => {
	const s = index?.sessions?.[id];
	if (!s?.project) throw Object.assign(new Error("no such conversation"), { status: 404 });
	return s;
};

// Answers a conversation (T059, research R6b): a session Rusuban started resumes in place, unless its
// run is at work; any other session is answered in a fork, which leaves the original as it was. The
// fork's run records `forkOf`. The person's text goes as is.
export function replyTo(index, id, text, request = requestRun) {
	const s = sessionIn(index, id);
	if (!String(text ?? "").trim())
		throw Object.assign(new Error("the answer is empty"), { status: 400 });
	const run = s.run ? readRun(s.run) : null;
	const fork = !run || ["queued", "running"].includes(run.state);
	const title = run?.title ?? s.title ?? "Untitled";
	const r = request({
		kind: "reply",
		project: s.project,
		mission: text,
		items: s.items,
		title,
		cwd: s.cwd,
		resume: id,
		fork,
		lock: `${s.project}.reply.${id}`,
		trigger: "button",
	});
	return { run: r.id, forked: fork, title, project: s.project };
}

// The command that opens a session in a terminal of this machine (T060), for the platform, on the
// runs' model like every launch of Claude Code (FR-098).
export function terminalCommand(s, model, platform = process.platform) {
	const resume = `claude --resume ${s.id} --model ${model}`;
	if (platform === "win32") return ["wt.exe", ["-d", s.cwd, "cmd", "/k", resume]];
	const quoted = `'${s.cwd.replace(/'/g, "'\\''")}'`; // a quote closes, is escaped, reopens
	if (platform === "darwin")
		return [
			"osascript",
			["-e", `tell application "Terminal" to do script "cd ${quoted} && ${resume}"`],
		];
	return [
		process.env.TERMINAL || "x-terminal-emulator",
		["-e", "sh", "-c", `cd ${quoted} && ${resume}; exec sh`],
	];
}

export function openTerminal(index, id, model, start = spawn) {
	const s = sessionIn(index, id);
	if (!s.cwd) throw Object.assign(new Error("no such conversation"), { status: 404 });
	if (!MODEL.test(model ?? "")) throw Object.assign(new Error(NO_MODEL), { status: 409 });
	const [cmd, args] = terminalCommand(s, model);
	start(cmd, args, { detached: true, stdio: "ignore", windowsHide: false })
		.on?.("error", () => {})
		?.unref?.();
	return { ok: true };
}
