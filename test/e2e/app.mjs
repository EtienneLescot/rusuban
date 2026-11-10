// The app under a click test: the real server (startServer) on a free port, over a temporary instance
// home seeded with two projects, a card in each, and two tasks, one of them at work; a project
// without a repo, with a task of its own that ran this morning; and a task that names no project.
// It reads no GitHub, and a run goes through the real runner with fake-claude (run.mjs).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";
import { runner } from "../../src/agents.mjs";
import { homePath, loadConfig, read, saveConfig, write } from "../../src/home.mjs";
import { scanHub, slugOf } from "../../src/hub.mjs";
import { applyJudgment } from "../../src/model.mjs";
import { startServer } from "../../src/server.mjs";

const RUN = fileURLToPath(new URL("./run.mjs", import.meta.url));
const conversationsDir = (cwd) => path.join(process.env.CLAUDE_CONFIG_DIR, "projects", slugOf(cwd));
const NOW = new Date().toISOString();
const LATER = new Date(Date.now() + 7 * 86400e3).toISOString();

const pr = (repo, n, title) => ({
	repo,
	n,
	title,
	url: `https://github.com/${repo}/pull/${n}`,
	author: "dana",
	draft: false,
	head: `h${n}`,
	base: "main",
	additions: 10,
	deletions: 2,
	files: [{ path: `src/f${n}.js`, additions: 10, deletions: 2, change: "MODIFIED" }],
	filesTruncated: false,
	refs: [],
	closes: [],
	mergeable: "MERGEABLE",
	canBeRebased: true,
	ci: { state: "success", runId: null, runIds: [], waiting: [] },
	checks: [{ name: "test", workflow: "CI", state: "success" }],
	reviews: {},
	threadsOpen: 0,
	createdAt: NOW,
	updatedAt: NOW,
});
const issue = (repo, n, title) => ({
	repo,
	n,
	title,
	url: `https://github.com/${repo}/issues/${n}`,
	author: "eve",
	labels: [],
	comments: 1,
	createdAt: NOW,
	updatedAt: NOW,
});
const card = (q) => ({
	urgency: "now",
	done: "I read the thread.",
	q,
	ctx: "Asked by two users.",
	rec: "build",
	why: "Small and wanted.",
	options: [
		{ id: "build", label: "Build it", effect: "I open a PR." },
		{ id: "close", label: "Close it", effect: "I close it, kindly." },
	],
});
const agent = (n, label, kind, auto) => ({
	n,
	label,
	kind,
	owner: "agent",
	next: "Merges once green.",
	revisitAt: LATER,
	pr: { head: `h${n}`, auto, why: "Small." },
});

// One project's files: what GitHub holds, its rules, and its judgments. Returns its card's id.
function project(id, slug, { prs, issues, judgments, rules }) {
	const repo = {
		defaultBranch: "main",
		prs,
		issues,
		merged: [],
		pushes: [],
		checkedAt: NOW,
		changedAt: NOW,
		error: null,
	};
	write(`projects/${id}/live.json`, { checkedAt: NOW, repos: { [slug]: repo }, rate: null });
	if (rules) write(`projects/${id}/rules.json`, { [slug]: rules });
	const judgment = { items: {} };
	for (const j of judgments) applyJudgment(j, { prs, issues }, judgment, { repos: [slug] });
	write(`projects/${id}/judgment.json`, judgment);
	return Object.values(judgment.items).find((j) => j.decision).decision.id;
}

export function seed(busyPid, checkout) {
	saveConfig({
		version: 1,
		owner: { login: "alice" },
		port: 0,
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 3, maxRunMinutes: 150 },
		projects: [
			{ id: "acme", title: "Acme", repos: [{ slug: "acme/widgets", checkout }] },
			{ id: "orbit", title: "Orbit", repos: [{ slug: "orbit/site" }] },
			{ id: "publications", title: "Publications" },
		],
		machines: [
			{ name: "mac", os: "macos", ssh: "mac", caps: ["gpu"] },
			{ name: "desk", os: "windows", ssh: "desk", owner: "alice" },
			{ name: "ci", os: "linux", ssh: "ci" },
		],
	});
	const acme = project("acme", "acme/widgets", {
		prs: [pr("acme/widgets", 11, "Fix the crash on save"), pr("acme/widgets", 12, "Install docs")],
		issues: [
			issue("acme/widgets", 21, "Dark mode"),
			issue("acme/widgets", 22, "Crash when offline"),
		],
		judgments: [
			agent(11, "Fix the crash on save", "bug", true),
			agent(12, "Install docs", "docs", false),
			{
				n: 21,
				label: "Dark mode",
				kind: "feature",
				owner: "alice",
				next: "Alice decides.",
				decision: card("Build dark mode?"),
			},
			{
				n: 22,
				label: "Crash when offline",
				kind: "bug",
				owner: "third",
				waits: "@eve's logs",
				next: "Waits for the logs.",
				revisitAt: LATER,
			},
		],
		rules: {
			observeOnly: false,
			ref: "main",
			treeSha: "t1",
			files: [{ name: "01.md", text: "Fixes merge alone." }],
			locks: { mergeMethod: "rebase" },
			errors: [],
			checkedAt: NOW,
		},
	});
	const orbit = project("orbit", "orbit/site", {
		prs: [pr("orbit/site", 32, "Translate the home page")],
		issues: [issue("orbit/site", 31, "New logo")],
		judgments: [
			agent(32, "Translate the home page", "translation", true),
			{
				n: 31,
				label: "New logo",
				kind: "question",
				owner: "alice",
				next: "Alice decides.",
				decision: card("Use the new logo?"),
			},
		],
	});
	fs.mkdirSync(homePath("tasks"), { recursive: true });
	fs.writeFileSync(
		homePath("tasks/digest.md"),
		"---\ntitle: Weekly digest\nproject: acme\n---\nWrite the weekly digest.\n",
	);
	fs.writeFileSync(
		homePath("tasks/release.md"),
		"---\ntitle: Release notes\nproject: acme\nschedule: daily 18:00\n---\nDraft the release notes.\n",
	);
	fs.writeFileSync(
		homePath("tasks/post.md"),
		"---\ntitle: Daily post\nproject: publications\n---\nWrite today's post.\n",
	);
	// A project since removed: its task shows in every project's section, with its error.
	fs.writeFileSync(
		homePath("tasks/letters.md"),
		"---\ntitle: Newsletter\nproject: letters\n---\nWrite the newsletter.\n",
	);
	// The release task at work, held by a process of its own (a Stop pressed by mistake kills only it).
	const id = "task-20261108100000-r001";
	write(`runs/${id}/status.json`, {
		id,
		kind: "task",
		title: "Release notes",
		project: "acme",
		items: [],
		session: null,
		trigger: "schedule",
		lock: "acme.task.release",
		attempt: 1,
		task: "release",
		state: "running",
		createdAt: NOW,
		startedAt: NOW,
		pid: busyPid,
		log: "run.log",
		step: "Reading the merged PRs",
		summary: null,
	});
	fs.writeFileSync(homePath(`runs/${id}/run.log`), "10:00:00  Reading the merged PRs\n");
	// Two Claude conversations in acme's checkout: one live on PR #11 from Claude Desktop, one ended
	// in a terminal on issue #22.
	const said = (id, entry, rows, cwd = checkout) =>
		fs.writeFileSync(
			path.join(conversationsDir(cwd), `${id}.jsonl`),
			`${rows.map((r) => JSON.stringify({ sessionId: id, cwd, entrypoint: entry, isSidechain: false, ...r })).join("\n")}\n`,
		);
	fs.mkdirSync(conversationsDir(checkout), { recursive: true });
	said("aaaaaaaa-0000-4000-8000-000000000011", "claude-desktop", [
		{ type: "custom-title", customTitle: "Fix the crash on save" },
		{
			type: "user",
			gitBranch: "fix/11-save",
			timestamp: NOW,
			message: { role: "user", content: "The app crashes on save. Find why." },
		},
		{
			type: "assistant",
			gitBranch: "fix/11-save",
			timestamp: NOW,
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "The save path writes before the folder exists." },
					{ type: "tool_use", name: "Bash", input: { command: "npm test -- save" } },
				],
			},
		},
		{
			type: "user",
			gitBranch: "fix/11-save",
			timestamp: NOW,
			message: {
				role: "user",
				content: [{ type: "tool_result", content: "1 failing: save without a folder" }],
			},
		},
		{
			type: "pr-link",
			prNumber: 11,
			prRepository: "acme/widgets",
			prUrl: "https://github.com/acme/widgets/pull/11",
			timestamp: NOW,
		},
	]);
	said("bbbbbbbb-0000-4000-8000-000000000022", "cli", [
		{
			type: "user",
			gitBranch: "main",
			timestamp: "2026-11-01T10:00:00.000Z",
			message: { role: "user", content: "Reproduce #22 offline." },
		},
		{
			type: "assistant",
			gitBranch: "main",
			timestamp: "2026-11-01T10:05:00.000Z",
			message: { role: "assistant", content: [{ type: "text", text: "Reproduced." }] },
		},
	]);
	fs.utimesSync(
		path.join(conversationsDir(checkout), "bbbbbbbb-0000-4000-8000-000000000022.jsonl"),
		new Date("2026-11-01T10:05:00Z"),
		new Date("2026-11-01T10:05:00Z"),
	);
	// The post task ran this morning in its project's scratch folder: its run and its conversation.
	const scratch = homePath("scratch/publications");
	const post = { id: "task-20261110083000-p001", session: "cccccccc-0000-4000-8000-000000000033" };
	write(`runs/${post.id}/status.json`, {
		...post,
		kind: "task",
		title: "Daily post",
		project: "publications",
		items: [],
		cwd: scratch,
		trigger: "schedule",
		lock: "publications.task.post",
		attempt: 1,
		task: "post",
		state: "done",
		createdAt: NOW,
		startedAt: NOW,
		endedAt: NOW,
		summary: "Posted the release thread.",
	});
	fs.mkdirSync(conversationsDir(scratch), { recursive: true });
	said(
		post.session,
		"sdk-cli",
		[
			{ type: "user", timestamp: NOW, message: { role: "user", content: "Write today's post." } },
			{
				type: "assistant",
				timestamp: NOW,
				message: { role: "assistant", content: [{ type: "text", text: "Posted." }] },
			},
		],
		scratch,
	);
	// The machines as the daemon probed them: mac held by a run, alice's desktop free, ci offline.
	const lease = {
		machine: "mac",
		run: "worker-20261108-1000-ab12",
		project: "acme",
		since: NOW,
		expires: new Date(Date.now() + 24 * 60e3).toISOString(),
		reason: "Measure the export",
	};
	write("leases/probes.json", {
		at: NOW,
		probes: [
			{ name: "mac", state: "online", checkedAt: NOW, lease, tailnet: null },
			{ name: "desk", state: "online", checkedAt: NOW, lease: null, tailnet: null },
			{
				name: "ci",
				state: "offline",
				checkedAt: NOW,
				lease: null,
				said: "ssh: connect to host ci port 22: Connection timed out",
				tailnet: null,
			},
		],
	});
	return { cards: { acme, orbit } };
}

// Started for every test, on its own home and port; a test that needs the card ids asks for `app`.
export const test = base.extend({
	app: [
		async ({ page }, use) => {
			process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-e2e-"));
			process.env.FAKE_CLAUDE_MS = "3000"; // a run started from the page stays at work a while
			const busy = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], {
				stdio: "ignore",
			});
			const children = [busy];
			const checkout = path.join(process.env.RUSUBAN_HOME, "acme-checkout");
			fs.mkdirSync(checkout, { recursive: true });
			process.env.CLAUDE_CONFIG_DIR = path.join(process.env.RUSUBAN_HOME, "claude");
			const seeded = seed(busy.pid, checkout);
			await scanHub({ config: loadConfig() });
			runner.launch = (id) =>
				children.push(spawn(process.execPath, [RUN, id], { stdio: "ignore" }));
			// No machine is reached: their probe is the seeded one, and a lease ends when asked.
			const srv = await startServer({
				port: 0,
				polling: false,
				quiet: true,
				tailnet: null,
				deps: {
					tendLeases: async () => [],
					probeMachines: async () => read("leases/probes.json").probes,
					releaseLease: async () => true,
				},
			});
			await page.goto(`http://127.0.0.1:${srv.port}/`);
			await use(seeded);
			await srv.close();
			for (const c of children) c.kill();
		},
		{ auto: true },
	],
});
