import "./tmp-root.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	assemblePrompt,
	builtInDeny,
	claudeLoggedIn,
	editRule,
	executeRun,
	holder,
	hookDir,
	kickQueues,
	listRuns,
	NO_MODEL,
	noteCrash,
	permissionArgs,
	pushHookWorks,
	pushRefusal,
	queued,
	readRun,
	requestRun,
	runClaude,
	runner,
	scratchOf,
	stopRun,
	usageLimitOf,
} from "../src/agents.mjs";
import { append, homePath, read, readJsonl, saveConfig, write } from "../src/home.mjs";
import { changeSetting, confirmRequest, tailscale } from "../src/settings.mjs";

const FAKE = [
	process.execPath,
	fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url)),
];
const launched = [];
runner.launch = (id) => launched.push(id);

// Every test starts with a project whose repo has rules and one PR nobody judged: a judge has work.
const PR = { repo: "o/r", n: 1, head: "abc", files: [], ci: { state: "success" }, checks: [] };
beforeEach(() => {
	process.env.RUSUBAN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-agents-"));
	launched.length = 0;
	for (const k of ["FAKE_CLAUDE_MS", "FAKE_CLAUDE_EXIT", "FAKE_CLAUDE_LIMIT", "FAKE_CLAUDE_MODEL"])
		delete process.env[k];
	write("projects/demo/live.json", {
		repos: { "o/r": { defaultBranch: "main", prs: [PR], issues: [] } },
	});
	write("projects/demo/rules.json", { "o/r": { observeOnly: false, files: [], errors: [] } });
});

const denied = (args) => args.slice(args.indexOf("--disallowedTools") + 1);
const WIN = process.platform === "win32";
const HOME = WIN ? "C:\\Users\\a\\.rusuban" : "/home/a/.rusuban";
const POSIX_HOME = WIN ? "//c/Users/a/.rusuban" : "//home/a/.rusuban";

test("the built-in deny rules come with both profiles, and the owner's deny rules only add", () => {
	const context = { home: HOME, defaultBranches: ["main", "main", "trunk"], port: 8790 };
	const builtIn = builtInDeny(context);
	for (const rule of [
		"Bash(*:8790*)",
		"Bash(*.ts.net*)",
		"Bash(*.rusuban*config.json*)",
		"Bash(*automerge.json*)",
		"Bash(*answers.jsonl*)",
		"Bash(gh pr merge*)",
		"Bash(gh api*merge*)",
		"Bash(git push* main)",
		"Bash(git push*:trunk)",
		`Edit(${POSIX_HOME}/config.json)`,
		`Edit(${POSIX_HOME}/projects/**)`,
		`Edit(${POSIX_HOME}/runs/**)`,
		`Edit(${POSIX_HOME}/bin/**)`,
	])
		assert.ok(builtIn.includes(rule), rule);
	// The agents' own folders under the home stay theirs.
	assert.ok(!builtIn.some((r) => /scratch|worktrees|repos|\.rusuban\/\*\*/.test(r)));
	assert.equal(builtIn.filter((r) => r === "Bash(git push* main)").length, 1);

	const bypass = permissionArgs({ mode: "bypass", allow: [], deny: ["Bash(curl*)"] }, context);
	assert.deepEqual(bypass.slice(0, 3), [
		"--setting-sources",
		"user",
		"--dangerously-skip-permissions",
	]);
	assert.deepEqual(denied(bypass), [...builtIn, "Bash(curl*)"]);

	const allowlist = permissionArgs(
		{ mode: "allowlist", allow: ["Bash(npm test*)", "Read"], deny: [] },
		context,
	);
	assert.deepEqual(allowlist.slice(0, 8), [
		"--setting-sources",
		"user",
		"--permission-mode",
		"dontAsk",
		"--allowedTools",
		"Bash(rusuban *)",
		"Bash(npm test*)",
		"Read",
	]);
	assert.deepEqual(denied(allowlist), builtIn);
	assert.ok(!allowlist.includes("--dangerously-skip-permissions"));
	assert.throws(() => permissionArgs({}, context), /bypass" or "allowlist/);

	// With the runs' pre-push hook, git resolves where a push goes: no rule names the branch, which a
	// fork's PR may carry too, and what would skip the hook is denied instead.
	const hooked = builtInDeny({ ...context, pushHook: true });
	assert.ok(!hooked.some((r) => r.startsWith("Bash(git push* ") || r.includes(":main")));
	for (const rule of [
		"Bash(gh api*git/refs/heads/main*)",
		"Bash(git push*--all*)",
		"Bash(git push*--no-v*)",
		"Bash(*hooksPath*)",
		"Bash(*GIT_CONFIG*)",
	])
		assert.ok(hooked.includes(rule), rule);
	assert.ok(!builtIn.includes("Bash(*GIT_CONFIG*)"));
});

test("no push reaches a project's default branch, but an open PR's head on a fork may be main", () => {
	const repos = [
		{
			slug: "Acme/Widgets",
			defaultBranch: "main",
			prs: [
				{ headRef: "main", headRepo: "Bob/widgets" }, // a contributor's PR from their main
				{ headRef: "main", headRepo: "acme/widgets" }, // the project's own main, to another base
				{ headRef: "fix", headRepo: "carol/widgets" },
			],
		},
		{ slug: "acme/tools", defaultBranch: "trunk", prs: [] },
	];
	const refused = (url, ...refs) => pushRefusal({ url, refs, repos });
	// Git hands the hook the URL it resolved: a remote's name, an insteadOf or a mirror end up here.
	for (const url of [
		"https://github.com/acme/widgets.git",
		"https://x-access-token:t@github.com/Acme/Widgets",
		"git@github.com:acme/widgets.git",
		"ssh://git@ssh.github.com:443/acme/widgets.git",
		"https://www.github.com/acme/widgets.git",
		"/home/a/mirror.git",
	])
		assert.match(refused(url, "refs/heads/main") ?? "", /main is a project's default branch/, url);
	assert.ok(refused("https://github.com/acme/widgets.git", "refs/heads/trunk"));
	// The contributor's PR head passes, however the URL is written; their fork's other defaults do not,
	// nor anyone's main that heads no open PR.
	for (const url of [
		"https://github.com/bob/widgets.git",
		"git@github.com:Bob/Widgets.git",
		"https://github.com/bob/widgets/",
	])
		assert.equal(refused(url, "refs/heads/main"), null, url);
	assert.match(
		refused("https://github.com/bob/widgets.git", "refs/heads/trunk"),
		/and bob\/widgets:trunk is not one\.$/,
	);
	assert.ok(refused("https://github.com/carol/widgets.git", "refs/heads/main"));
	assert.ok(refused("https://github.com/bob/other.git", "refs/heads/main"));
	assert.ok(refused("https://github.com/bob/widgets.git", "refs/heads/main", "refs/heads/trunk"));
	// Other branches, and a tag of that name, pass.
	assert.equal(
		refused("https://github.com/acme/widgets.git", "refs/heads/fix", "refs/tags/main"),
		null,
	);
	// A repo whose default branch is not read yet: main and master are kept from every remote.
	const unread = (ref) =>
		pushRefusal({
			url: "https://github.com/acme/new.git",
			refs: [ref],
			repos: [{ slug: "acme/new" }],
		});
	assert.ok(unread("refs/heads/master"));
	assert.equal(unread("refs/heads/dev"), null);
});

test("a run's git asks Rusuban before every push, and the repo's own hooks still run", (t) => {
	saveConfig(config);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-push-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const work = path.join(dir, "work");
	const env = {
		...process.env,
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "core.hooksPath",
		GIT_CONFIG_VALUE_0: hookDir(),
	};
	const git = (args, cwd = work) => spawnSync("git", args, { cwd, env, encoding: "utf8" });
	git(["init", "-q", "--bare", "remote.git"], dir);
	git(["init", "-q", "work"], dir);
	// The repo's own hooks, where husky puts them: a core.hooksPath relative to the worktree.
	fs.mkdirSync(path.join(work, ".hooks"));
	fs.writeFileSync(path.join(work, ".hooks/pre-commit"), "#!/bin/sh\necho pre-commit > ../ran\n");
	fs.writeFileSync(path.join(work, ".hooks/pre-push"), "#!/bin/sh\ncat >> ../ran\n");
	for (const f of ["pre-commit", "pre-push"]) fs.chmodSync(path.join(work, ".hooks", f), 0o755);
	git(["config", "core.hooksPath", ".hooks"]);
	git(["-c", "user.name=a", "-c", "user.email=a@b.c", "commit", "-q", "--allow-empty", "-m", "a"]);
	// To the project's default branch, however the refspec names it: refused before anything leaves.
	for (const spec of ["HEAD:main", "+HEAD:refs/heads/main"]) {
		const r = git(["push", "../remote.git", spec]);
		assert.notEqual(r.status, 0, spec);
		assert.match(r.stderr, /Rusuban refuses this push: main is a project's default branch/, spec);
	}
	assert.equal(git(["branch", "--list"], path.join(dir, "remote.git")).stdout, "");
	// Another branch goes, and the repo's own pre-push reads the lines git gave Rusuban's.
	const ok = git(["push", "-q", "../remote.git", "HEAD:fix"]);
	assert.equal(ok.status, 0, ok.stderr);
	assert.match(
		fs.readFileSync(path.join(dir, "ran"), "utf8"),
		/^pre-commit\nHEAD [0-9a-f]{40} refs\/heads\/fix 0{40}\n$/,
	);
});

test("path rules are POSIX, a Windows drive written /c", () => {
	assert.equal(editRule(HOME), `Edit(${POSIX_HOME}/**)`);
	assert.equal(editRule(path.join(HOME, "config.json"), false), `Edit(${POSIX_HOME}/config.json)`);
});

const config = {
	version: 1,
	owner: { login: "alice" },
	port: 0,
	permissions: { mode: "bypass", allow: [], deny: [] },
	limits: { maxWorkers: 3, maxRunMinutes: 150 },
	model: "claude-test",
	projects: [{ id: "demo", title: "Demo", repos: [{ slug: "o/r" }] }],
	machines: [],
	channels: [],
};
const request = (over = {}) =>
	requestRun({ kind: "judge", project: "demo", mission: "", lock: "demo.coordinator", ...over });
const RULES = {
	"o/r": {
		observeOnly: false,
		ref: "main",
		treeSha: "tree123",
		files: [{ name: "01-merge.md", text: "Bug fixes merge alone." }],
		locks: { mergeMethod: "squash" },
		errors: [],
	},
};

test("a prompt is the product prompt, the frame, the rules with their source, the context, the mission", () => {
	write("projects/demo/rules.json", RULES);
	const card = { to: "alice", q: "Ship the new parser?", resolvedAt: null, options: [] };
	const proposal = {
		id: "rule:1",
		items: ["o/r#7", "o/r#8"],
		q: "Make it a rule?",
		resolvedAt: null,
	};
	write("projects/demo/judgment.json", {
		items: { "o/r#7": { owner: "alice", decision: card } },
		proposals: { "rule:1": proposal },
	});
	const p = assemblePrompt({ kind: "judge", project: "demo", config, run: "judge-1" });
	const at = (s) => {
		const i = p.indexOf(s);
		assert.ok(i >= 0, `missing: ${s}`);
		return i;
	};
	const order = [
		"# You are the judge",
		"# Judgments, cards and workers",
		"# Safety frame",
		"# Project rules: o/r@tree123:.rusuban/rules/",
		"Bug fixes merge alone.",
		"# Context",
		"- Owner: @alice.",
		"default branch `main`",
		'"mergeMethod":"squash"',
		"- o/r#7, to @alice: Ship the new parser?",
		"- Rule proposal `rule:1`, for o/r#7, o/r#8: Make it a rule?",
	].map(at);
	assert.deepEqual(
		order,
		[...order].sort((a, b) => a - b),
	);
	assert.ok(!p.includes("## Answers to carry out"), "answers go to the coordinator only");

	const worker = assemblePrompt({
		kind: "worker",
		project: "demo",
		mission: "Fix #12.",
		config,
		run: "w-1",
	});
	assert.ok(worker.startsWith("# You are a worker") && worker.trimEnd().endsWith("Fix #12."));
	assert.ok(!worker.includes("# Judgments, cards and workers"));

	const pending = {
		answers: [
			{
				item: "o/r#7",
				card: "c1",
				q: "Ship?",
				chosen: { label: "Merge it", effect: "The server merges it.", merge: true },
			},
			{
				item: "rule:1",
				card: "rule:1",
				q: "Make it a rule?",
				chosen: { label: "Open the rule PR", effect: "I open a PR adding this rule." },
				rule: "Bug fixes merge alone.",
				file: ".rusuban/rules/01-merge.md",
				repo: "o/r",
				items: ["o/r#7", "o/r#8"],
			},
		],
		asks: [{ at: "2026-11-07T10:00:00Z", text: "Close the stale issues." }],
		reports: [{ worker: "fix-12", item: "o/r#12", state: "done", text: "PR #13 opened." }],
	};
	const act = assemblePrompt({ kind: "act", project: "demo", config, run: "act-1", pending });
	for (const s of [
		"a merge order the server carries out",
		'Rule proposal `rule:1` ("Make it a rule?") for o/r#7, o/r#8',
		'its rule for o/r\'s .rusuban/rules/01-merge.md: "Bug fixes merge alone."',
		"Close the stale issues.",
		"PR #13 opened.",
	])
		assert.ok(act.includes(s), s);

	write("projects/demo/rules.json", {});
	assert.match(
		assemblePrompt({ kind: "judge", project: "demo", config, run: "j" }),
		/has rules yet: do nothing autonomous/,
	);
	// A project without a repo: its tasks are the owner's word, no rules come from GitHub.
	const posts = { ...config, projects: [{ id: "posts", title: "Posts", repos: [] }] };
	const task = assemblePrompt({ kind: "task", project: "posts", config: posts, run: "t" });
	assert.match(task, /This project has no repo: no rules come from GitHub/);
	assert.doesNotMatch(task, /do nothing autonomous/);
	assert.throws(
		() => assemblePrompt({ kind: "judge", project: "gone", config, run: "j" }),
		/unknown project/,
	);
});

test("a run builds its prompt when it starts, works in its folder with rusuban on its PATH, and records everything", async () => {
	const { id, state } = request({ items: ["o/r#1"], mission: "Look at #1 first." });
	assert.deepEqual([state, launched], ["started", [id]]);
	assert.equal(readRun(id).state, "queued");
	const done = await executeRun(id, { config, command: FAKE });
	assert.equal(done.state, "done");
	assert.equal(done.session, "00000000-0000-4000-8000-000000000001");
	assert.match(done.step, /^Reading: # You are the judge/);
	assert.deepEqual(done.denials, [{ tool: "Bash", input: "gh pr merge 1" }]);
	const reported = JSON.parse(done.summary);
	assert.deepEqual([reported.run, reported.project], [id, "demo"]);
	assert.equal(fs.realpathSync(reported.cwd), fs.realpathSync(scratchOf("demo")));
	assert.equal(reported.cli, homePath("bin"));
	assert.ok(fs.existsSync(homePath("bin/rusuban")) && fs.existsSync(homePath("bin/rusuban.cmd")));
	assert.ok(reported.args.includes("--dangerously-skip-permissions"));
	const context = { home: process.env.RUSUBAN_HOME, defaultBranches: ["main"] };
	for (const rule of builtInDeny({ ...context, pushHook: pushHookWorks() }))
		assert.ok(reported.args.includes(rule), rule);
	assert.equal(reported.args.includes("Bash(git push*:main)"), !pushHookWorks());
	// Every git of the run takes its hooks: pre-push asks Rusuban.
	assert.equal(reported.hooks, homePath("bin/hooks").replace(/\\/g, "/"));
	assert.ok(fs.existsSync(homePath("bin/hooks/pre-push")));
	assert.match(
		fs.readFileSync(homePath(`runs/${id}/prompt.md`), "utf8"),
		/# Your mission\n\nLook at #1 first\./,
	);
	const log = fs.readFileSync(homePath(`runs/${id}/${done.log}`), "utf8");
	assert.match(log, /→ Bash gh pr merge 1/);
	assert.match(log, /denied: Bash gh pr merge 1/);
	assert.deepEqual(readRun(id), done);
	assert.equal(holder("demo.coordinator"), null);
});

// Every way a run starts Claude Code: one that forgot the model would run on the default.
test("every launch asks for the owner's model, and each run keeps the one its session announced", async () => {
	append("projects/demo/asks.jsonl", { at: "2026-11-07T10:00:00Z", text: "Look." });
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-model-"));
	const reply = (session, fork = false) =>
		request({
			kind: "reply",
			mission: "Go on.",
			cwd,
			resume: session,
			fork,
			lock: `demo.reply.${session}`,
		});
	const launches = {
		judge: request(),
		coordinator: request({ kind: "act" }),
		task: request({
			kind: "task",
			mission: "Write.",
			title: "Digest",
			task: "digest",
			lock: "demo.task.digest",
		}),
		resume: reply("s-1"),
		fork: reply("s-2", true),
	};
	for (const [what, { id }] of Object.entries(launches)) {
		const done = await executeRun(id, { config, command: FAKE });
		const { args } = JSON.parse(done.summary);
		const at = args.indexOf("--model");
		assert.deepEqual(args.slice(at, at + 2), ["--model", "claude-test"], what);
		assert.deepEqual([done.model, done.modelAsked], ["claude-test", "claude-test"], what);
	}
	// A session on another model than the one asked for keeps what it said, for the page to show.
	process.env.FAKE_CLAUDE_MODEL = "claude-other";
	const off = await executeRun(request().id, { config, command: FAKE });
	assert.deepEqual([off.model, off.modelAsked], ["claude-other", "claude-test"]);
});

test("without a model no run starts: never one on Claude Code's default", async () => {
	const none = await executeRun(request().id, {
		config: { ...config, model: undefined },
		command: FAKE,
	});
	assert.deepEqual(
		[none.state, none.session, none.summary],
		["failed", null, `Could not start: ${NO_MODEL}`],
	);
	assert.throws(
		() => runClaude({ prompt: "x", cwd: os.tmpdir(), logFile: homePath("x.log"), command: FAKE }),
		{ message: NO_MODEL },
	);
	assert.ok(!fs.existsSync(homePath("x.log")), "claude is never started");
});

test("a run's status is read again when its file changes, and given as a copy", () => {
	const id = "worker-20261111-0000-aa11";
	const status = (over) =>
		write(`runs/${id}/status.json`, {
			id,
			kind: "worker",
			project: "demo",
			state: "running",
			pid: process.pid,
			createdAt: "2026-11-11T00:00:00.000Z",
			...over,
		});
	status({ step: "Reading" });
	assert.equal(readRun(id).step, "Reading");
	status({ step: "Writing the fix" }); // another size: read again
	assert.equal(readRun(id).step, "Writing the fix");
	assert.equal(listRuns("demo").find((r) => r.id === id).step, "Writing the fix");
	// A caller's change stays its own.
	readRun(id).step = "changed by a caller";
	assert.equal(readRun(id).step, "Writing the fix");
	// A run whose process died is interrupted, whatever its file says.
	status({ step: "Writing the fix", pid: 999999 });
	assert.equal(readRun(id).state, "interrupted");
	// Settled, it is listed as it ended; gone, it is no longer read.
	status({ state: "done", endedAt: "2026-11-11T00:05:00.000Z", summary: "Fixed." });
	assert.equal(listRuns("demo").find((r) => r.id === id).summary, "Fixed.");
	fs.rmSync(homePath(`runs/${id}`), { recursive: true });
	assert.equal(readRun(id), null);
	assert.equal(
		listRuns("demo").some((r) => r.id === id),
		false,
	);
});

test("a run of a project no longer configured does not start", async () => {
	const gone = await executeRun(request().id, {
		config: { ...config, projects: [] },
		command: FAKE,
	});
	assert.deepEqual(
		[gone.state, gone.summary],
		["failed", 'Could not start: unknown project "demo"'],
	);
});

test("runs of one lock group go one after the other, in order of request", async () => {
	process.env.FAKE_CLAUDE_MS = "300";
	const a = request();
	const first = executeRun(a.id, { config, command: FAKE });
	const b = request();
	const c = request();
	assert.deepEqual([b.state, c.state], ["queued", "queued"]);
	assert.deepEqual(queued("demo.coordinator"), [b.id, c.id]);
	assert.equal(holder("demo.coordinator").run, a.id);
	await first;
	// The finished run hands over to the next one in line, and only that one.
	assert.deepEqual(launched, [a.id, b.id]);
	assert.deepEqual(queued("demo.coordinator"), [c.id]);
	assert.equal(request({ kind: "act", lock: "demo.act" }).state, "started");
});

test("a coordinator run that ends well consumes the requests and reports it was given; a failed one does not", async () => {
	for (const text of ["one", "two"])
		append("projects/demo/asks.jsonl", { at: "2026-11-07T10:00:00Z", text });
	append("projects/demo/reports.jsonl", {
		run: "w",
		worker: "fix",
		item: "o/r#1",
		state: "done",
		text: "ok",
	});
	process.env.FAKE_CLAUDE_EXIT = "2";
	const failed = await executeRun(request({ kind: "act" }).id, { config, command: FAKE });
	assert.equal(failed.state, "failed");
	assert.equal(read("projects/demo/consumed.json", null), null);
	delete process.env.FAKE_CLAUDE_EXIT;
	await executeRun(request({ kind: "act" }).id, { config, command: FAKE });
	assert.deepEqual(read("projects/demo/consumed.json"), { asks: 2, reports: 1 });
});

test("a usage limit makes the run limited until the reset, holds every queue, then asks the run again", async () => {
	const reset = Math.floor(Date.now() / 1000) + 3600;
	process.env.FAKE_CLAUDE_LIMIT = `Claude AI usage limit reached|${reset}`;
	const { id } = request({ mission: "Judge #1." });
	const limited = await executeRun(id, { config, command: FAKE });
	assert.deepEqual(
		[limited.state, limited.retryAt],
		["limited", new Date(reset * 1000).toISOString()],
	);
	assert.equal(read("runs/limit.json").until, limited.retryAt);
	launched.length = 0;
	const waiting = request();
	assert.equal(waiting.state, "queued", "nothing starts while the account is limited");
	kickQueues(Date.parse(limited.retryAt) - 1000);
	assert.deepEqual(launched, []);
	write("runs/limit.json", { until: new Date(Date.now() - 1000).toISOString() });
	kickQueues(Date.parse(limited.retryAt) + 1000);
	const again = listRuns("demo").find((r) => r.retryOf === id);
	assert.deepEqual([again.attempt, again.state, readRun(id).retriedBy], [2, "queued", again.id]);
	assert.match(fs.readFileSync(homePath(`runs/${again.id}/mission.md`), "utf8"), /Judge #1\./);
	assert.deepEqual(launched, [waiting.id, again.id], "the queue starts again, in order");
});

test("a usage-limit message gives its reset time, or none; other errors are not limits", () => {
	const now = new Date(2026, 10, 7, 13, 0);
	assert.equal(
		usageLimitOf("Claude AI usage limit reached|1767225600").resetAt,
		"2026-01-01T00:00:00.000Z",
	);
	const at3pm = new Date(usageLimitOf("5-hour limit reached ∙ resets 3pm", now).resetAt);
	assert.deepEqual([at3pm.getHours(), at3pm.getDate()], [15, 7]);
	const tomorrow = new Date(usageLimitOf("You've hit your limit · resets 9am", now).resetAt);
	assert.deepEqual([tomorrow.getHours(), tomorrow.getDate()], [9, 8]);
	assert.deepEqual(usageLimitOf("Usage limit reached."), { resetAt: null });
	assert.equal(usageLimitOf("API Error: 500 Internal Server Error"), null);
});

test("a run whose runner died goes back to its queue, twice at most; a stopped one stays stopped", () => {
	const dead = request();
	write(`runs/${dead.id}/status.json`, {
		...readRun(dead.id),
		state: "running",
		pid: 2 ** 22 + 12345,
	});
	kickQueues();
	const retry = listRuns("demo").find((r) => r.retryOf === dead.id);
	assert.equal(retry.attempt, 2);
	write(`runs/${retry.id}/status.json`, {
		...readRun(retry.id),
		state: "running",
		pid: 2 ** 22 + 12346,
		attempt: 3,
	});
	kickQueues();
	assert.equal(listRuns("demo").filter((r) => r.retryOf === retry.id).length, 0);
	const waiting = request();
	assert.equal(stopRun(waiting.id, "Not needed.").state, "stopped");
	assert.ok(!queued("demo.coordinator").includes(waiting.id));
});

test("a run cut short says why in the journal, once: its runner's crash, the host's restart, or neither", (t) => {
	t.mock.method(os, "uptime", () => 60); // the host started a minute ago
	const cut = (over = {}) => {
		const { id } = request();
		write(`runs/${id}/status.json`, {
			...readRun(id),
			state: "running",
			pid: 2 ** 22 + 12345,
			startedAt: new Date().toISOString(),
			...over,
		});
		return id;
	};
	const crashed = cut();
	noteCrash(crashed, new Error("EPERM: operation not permitted, rename 'a' -> 'b'\n    at write"));
	const rebooted = cut({ startedAt: new Date(Date.now() - 600e3).toISOString() });
	const killed = cut();
	const third = cut({ attempt: 3 });
	kickQueues();
	kickQueues();
	const told = readJsonl("projects/demo/journal.jsonl").filter((e) => e.kind === "interrupted");
	assert.equal(told.length, 4, "each told once");
	const said = (id) => told.find((e) => e.run === id);
	const retry = (id) => listRuns("demo").find((r) => r.retryOf === id)?.id;
	const why = {
		[crashed]: "its runner crashed (EPERM: operation not permitted, rename 'a' -> 'b')",
		[rebooted]: "the host restarted",
		[killed]: "its runner ended without saying why (killed, or out of disk or memory)",
	};
	for (const [id, text] of Object.entries(why)) {
		assert.equal(
			said(id).text,
			`The judge run was cut short: ${text}. Asked again as ${retry(id)}.`,
		);
		assert.equal(said(id).notify, undefined);
		assert.deepEqual(
			[readRun(id).state, readRun(id).summary],
			["interrupted", `Cut short: ${text}.`],
		);
		assert.ok(readRun(id).endedAt);
	}
	assert.equal(
		said(third).text,
		`The judge run was cut short: ${why[killed]}. Not asked again: it was cut short three times.`,
	);
	assert.deepEqual([said(third).notify, retry(third)], [true, undefined]);
});

test("a setting allowed while a run works does not cut the run short", async (t) => {
	// 2026-11-08: the owner allowed remote access while a judge worked. As the daemon read the runs to
	// tell the page, Windows refused the runner the rename that saves the run's status (EPERM: another
	// process has the file open), and the uncaught error ended the runner, and the judge with it.
	saveConfig(config);
	const real = tailscale.run;
	t.after(() => {
		tailscale.run = real;
	});
	tailscale.run = (args) =>
		args[0] === "status"
			? JSON.stringify({
					BackendState: "Running",
					Self: { DNSName: "box.tail1.ts.net.", UserID: 7 },
					User: { 7: { LoginName: "alice@example.com" } },
				})
			: "";
	const asked = changeSetting({ kind: "remote", on: true }, { origin: "mcp", by: "claude" });
	process.env.FAKE_CLAUDE_MS = "2500"; // past the save of the run's step, 2 s after it comes
	const { id } = request();
	const status = homePath(`runs/${id}/status.json`);
	const rename = fs.renameSync;
	let refusals = 0;
	t.mock.method(fs, "renameSync", (from, to) => {
		if (to === status && refusals > 0) {
			refusals--;
			throw Object.assign(
				new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`),
				{
					code: "EPERM",
				},
			);
		}
		return rename(from, to);
	});
	const working = executeRun(id, { config, command: FAKE });
	while (!readRun(id)?.session) await new Promise((r) => setTimeout(r, 20));
	assert.equal(confirmRequest(asked.id, { allow: true, by: "alice" }).state, "confirmed");
	refusals = 3; // the daemon reads every run's status as it tells the page
	const done = await working;
	assert.equal(refusals, 0, "the run's save was refused three times");
	assert.equal(done.state, "done");
	assert.equal(readRun(id).state, "done");
});

test("a queue whose holder died is restarted", () => {
	write("runs/locks/demo.judge.json", { pid: 2 ** 22 + 12345, run: "gone" });
	write("runs/locks/demo.judge.queue.json", ["judge-1", "judge-2"]);
	kickQueues();
	assert.deepEqual(launched, ["judge-1"]);
	assert.deepEqual(queued("demo.judge"), ["judge-2"]);
});

test("a run that finds its work done when it starts ends without a session", async () => {
	write("projects/demo/judgment.json", {
		items: {
			"o/r#1": {
				owner: "agent",
				revisitAt: "2099-01-01T00:00:00Z",
				pr: { head: "abc", auto: false },
			},
		},
	});
	const judge = await executeRun(request().id, { config, command: FAKE });
	assert.deepEqual(
		[judge.state, judge.session, judge.summary],
		["done", null, "Nothing to judge when the run started."],
	);
	// Nor is a fork's CI approval a judge ended on, while its head stays.
	const fork = { ...PR, ci: { state: "action_required", runIds: [7], waiting: [] } };
	write("projects/demo/live.json", { repos: { "o/r": { defaultBranch: "main", prs: [fork] } } });
	write("projects/demo/triggers.json", { examined: { "o/r#1": "abc" } });
	const examined = await executeRun(request().id, { config, command: FAKE });
	assert.equal(examined.summary, "Nothing to judge when the run started.");
	const act = await executeRun(request({ kind: "act" }).id, { config, command: FAKE });
	assert.deepEqual([act.state, act.summary], ["done", "Nothing waited when the run started."]);
});

test("a reply sends the person's text as is to the session it resumes, in a fork or in place", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-reply-"));
	const reply = (session, over = {}) =>
		requestRun({
			kind: "reply",
			project: "demo",
			mission: "Also check the rights.",
			title: "Save",
			cwd,
			resume: session,
			lock: `demo.reply.${session}`,
			trigger: "button",
			...over,
		});
	const fork = reply("s-1", { fork: true });
	assert.equal(readRun(fork.id).forkOf, "s-1");
	const done = await executeRun(fork.id, { config, command: FAKE });
	assert.equal(done.state, "done");
	const { args, cwd: ranIn } = JSON.parse(done.summary);
	const at = args.indexOf("--resume");
	assert.deepEqual(args.slice(at, at + 3), ["--resume", "s-1", "--fork-session"]);
	assert.equal(fs.realpathSync(ranIn), fs.realpathSync(cwd));
	assert.equal(
		fs.readFileSync(homePath(`runs/${fork.id}/prompt.md`), "utf8"),
		"Also check the rights.",
	);
	const inPlace = reply("s-2");
	assert.equal(readRun(inPlace.id).forkOf, null);
	const again = JSON.parse((await executeRun(inPlace.id, { config, command: FAKE })).summary).args;
	assert.deepEqual(again.slice(again.indexOf("--resume"), again.indexOf("--resume") + 2), [
		"--resume",
		"s-2",
	]);
	assert.ok(!again.includes("--fork-session"));
});

test("the context lists the machines as the daemon last probed them, a desktop's owner named", () => {
	const machines = [
		{
			name: "mac",
			os: "macos",
			ssh: "mac",
			caps: ["gpu"],
			workspace: "~/rusuban",
			agentUser: "rusuban",
		},
		{
			name: "desk",
			os: "windows",
			ssh: "desk",
			caps: [],
			workspace: "~/rusuban",
			agentUser: "rusuban",
			owner: "alice",
		},
		{ name: "ci", os: "linux", ssh: "ci", caps: [], workspace: "/srv/r", agentUser: "rusuban" },
		{ name: "new", os: "linux", ssh: "new", caps: [], workspace: "~/r", agentUser: "rusuban" },
	];
	write("leases/probes.json", {
		at: "2026-11-08T10:00:00.000Z",
		probes: [
			{ name: "mac", state: "online", lease: { run: "w-1", expires: "2026-11-08T10:30:00.000Z" } },
			{ name: "desk", state: "online", lease: null },
			{ name: "ci", state: "offline", lease: null },
		],
	});
	const p = assemblePrompt({
		kind: "worker",
		project: "demo",
		config: { ...config, machines },
		run: "w-2",
		mission: "Measure it.",
	});
	assert.match(p, /- Machines, each taken with `rusuban lease`/);
	assert.match(
		p,
		/ {2}- mac: macOS, `ssh -l rusuban mac`, workspace `~\/rusuban`, gpu; held by run `w-1` until 2026-11-08T10:30:00.000Z\./,
	);
	assert.match(
		p,
		/ {2}- desk: Windows, `ssh -l rusuban desk`, workspace `~\/rusuban`, @alice's desktop: a lease asks them first; free\./,
	);
	assert.match(p, / {2}- ci: Linux, .*; offline\./);
	assert.match(p, / {2}- new: Linux, .*; not probed yet\./);
	assert.match(
		assemblePrompt({ kind: "judge", project: "demo", config, run: "j" }),
		/- Machines: none registered\./,
	);
});

test("with a person's desktop registered, every Bash command of a run passes the desktop guard first", () => {
	const settingsOf = (args) => {
		const at = args.indexOf("--settings");
		return at < 0 ? null : JSON.parse(args[at + 1]);
	};
	for (const mode of ["bypass", "allowlist"]) {
		assert.equal(settingsOf(permissionArgs({ mode }, { home: HOME })), null, mode);
		assert.deepEqual(settingsOf(permissionArgs({ mode }, { home: HOME, guard: true })), {
			hooks: {
				PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rusuban guard" }] }],
			},
		});
	}
});

test("init reads Claude Code's login from `claude auth status`, which exits 1 when logged out", () => {
	// What `claude auth status` does: its JSON on stdout, and exit 1 when it says logged out (T078).
	const said =
		(stdout, status = 0) =>
		() => {
			if (!status) return stdout;
			throw Object.assign(new Error(`exit ${status}`), { status, stdout });
		};
	assert.equal(claudeLoggedIn({ exec: said('{"loggedIn": true}') }), true);
	assert.equal(claudeLoggedIn({ exec: said('{"loggedIn": false}', 1) }), false);
	// Not installed, failing otherwise, or saying something else: it does not answer.
	const missing = () => {
		throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
	};
	assert.equal(claudeLoggedIn({ exec: missing }), null);
	assert.equal(claudeLoggedIn({ exec: said("", 2) }), null);
	assert.equal(claudeLoggedIn({ exec: said("error: unknown command 'auth'", 1) }), null);
});
