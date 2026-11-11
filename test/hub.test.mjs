import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { read, validateConfig, write } from "../src/home.mjs";
import {
	hubState,
	listConversations,
	openTerminal,
	readPage,
	replyTo,
	runTitle,
	scanHub,
	slugOf,
	terminalCommand,
} from "../src/hub.mjs";

const FIXTURES = new URL("./fixtures/transcripts/", import.meta.url);
const RUN = "worker-20261104-0915-ab12";

// Each test has its own Rusuban home, its own work folder holding the project's checkout, and its own
// Claude Code projects folder, where the transcripts go.
let home;
let work;
let root;
let config;
beforeEach(() => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rusuban-hub-"));
	home = path.join(tmp, "home");
	work = path.join(tmp, "work");
	root = path.join(tmp, "claude-projects");
	process.env.RUSUBAN_HOME = home;
	config = validateConfig({
		version: 1,
		owner: { login: "alice" },
		permissions: { mode: "allowlist" },
		limits: { maxWorkers: 3, maxRunMinutes: 150 },
		projects: [
			{
				id: "widgets",
				repos: [{ slug: "acme/widgets", checkout: path.join(work, "widgets") }],
				folders: [path.join(work, "notes")],
			},
		],
	});
});

// A transcript where Claude Code writes it: in the folder named after the folder it started in.
function place(id, startedIn, text) {
	const dir = path.join(root, slugOf(startedIn));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${id}.jsonl`), text);
	return path.join(dir, `${id}.jsonl`);
}
const esc = (p) => JSON.stringify(p).slice(1, -1);
const fixture = (name) =>
	fs
		.readFileSync(new URL(`${name}.jsonl`, FIXTURES), "utf8")
		.replaceAll("$ROOT", () => esc(work))
		.replaceAll("$HOME", () => esc(home));
const said = (id, cwd, text, at = "2026-11-05T10:00:00.000Z") =>
	`${JSON.stringify({ type: "user", message: { role: "user", content: text }, timestamp: at, cwd, sessionId: id, entrypoint: "cli" })}\n`;
const setTime = (file, iso) => fs.utimesSync(file, new Date(iso), new Date(iso));

const pr = (n, headRef) => ({ repo: "acme/widgets", n, headRef });
const issue = (n) => ({ repo: "acme/widgets", n });
const live = (prs, issues, merged = []) =>
	write("projects/widgets/live.json", {
		repos: { "acme/widgets": { defaultBranch: "main", prs, issues, merged } },
	});

// The four fixtures, the project's live state, and the run that started the sdk-cli session.
function placeFixtures() {
	live(
		[pr(1480, "fix/1475-keyframes"), pr(1490, "feat/export-presets"), pr(1471, "main")],
		[issue(1475), issue(1502)],
		[issue(1466)],
	);
	write(`runs/${RUN}/status.json`, {
		id: RUN,
		kind: "worker",
		project: "widgets",
		items: ["acme/widgets#1475"],
		session: "sdk-cli",
		cwd: path.join(home, "worktrees", "widgets", RUN),
		state: "done",
		createdAt: "2026-11-04T09:15:00.000Z",
	});
	const checkout = path.join(work, "widgets");
	setTime(place("desktop", checkout, fixture("desktop")), "2026-11-02T09:31:52.000Z");
	place("cli", checkout, fixture("cli"));
	place("sdk-cli", path.join(home, "worktrees", "widgets", RUN), fixture("sdk-cli"));
	setTime(place("unknown-format", checkout, fixture("unknown-format")), "2026-11-05T08:00:00.000Z");
}

test("discovery keeps the sessions held in a project's folders, by their folder, never by its slug", async () => {
	const checkout = path.join(work, "widgets");
	// A worktree git put outside the checkout, recorded the way git writes it on every OS.
	const outside = path.join(work, "elsewhere", "ext");
	fs.mkdirSync(path.join(checkout, ".git", "worktrees", "ext"), { recursive: true });
	fs.writeFileSync(
		path.join(checkout, ".git", "worktrees", "ext", "gitdir"),
		`${path.join(outside, ".git").replaceAll("\\", "/")}\n`,
	);
	const session = (id, cwd) => place(id, cwd, said(id, cwd, `Work in ${path.basename(cwd)}`));
	session("in-checkout", path.join(checkout, "site"));
	session("sibling", path.join(work, "widgets-site"));
	session("in-worktree", outside);
	session("in-extra-folder", path.join(work, "notes"));
	session("elsewhere", path.join(work, "other"));
	// The same session copied into two folders: its newest copy is the one read.
	const old = place("moved", checkout, said("moved", checkout, "Before the move"));
	setTime(old, "2026-11-05T09:00:00.000Z");
	const moved = path.join(checkout, ".claude", "worktrees", "x");
	const copy = place(
		"moved",
		moved,
		said("moved", checkout, "Before the move") + said("moved", moved, "After"),
	);

	const index = await scanHub({ config, root });
	assert.equal(slugOf(path.join(checkout, "site")), slugOf(path.join(work, "widgets-site")));
	assert.deepEqual(
		listConversations(index)
			.map((c) => c.id)
			.sort(),
		["in-checkout", "in-extra-folder", "in-worktree", "moved"],
	);
	assert.equal(index.sessions.sibling.project, null); // read, as its folder's slug matched, then left out
	assert.equal(index.sessions.elsewhere, undefined); // a slug no project folder starts: never read
	assert.equal(index.sessions.moved.file, copy);
	assert.equal(path.resolve(index.sessions.moved.cwd), moved);
	assert.equal(index.files[old], undefined);
});

test("the parser reads each session's title, origin, folder, branch, PR links and times", async () => {
	placeFixtures();
	const index = await scanHub({ config, root });
	const { desktop, cli } = index.sessions;
	const sdk = index.sessions["sdk-cli"];

	assert.equal(desktop.title, "Keyframe jitter on scrub"); // its custom title, over its first message
	assert.equal(desktop.origin, "claude-desktop");
	assert.equal(
		path.resolve(desktop.cwd),
		path.join(work, "widgets", ".claude", "worktrees", "keyframes"),
	);
	assert.equal(desktop.branch, "fix/1475-keyframes");
	assert.deepEqual(desktop.prs, [
		{ repo: "acme/widgets", n: 1480, url: "https://github.com/acme/widgets/pull/1480" },
	]);
	assert.equal(desktop.firstAt, "2026-11-02T09:14:02.900Z");
	assert.equal(desktop.lastAt, "2026-11-02T09:31:52.000Z");
	assert.equal(desktop.parseError, "1 unreadable line");
	assert.equal(desktop.live, false); // its file was last written days ago

	assert.equal(cli.title, "export-presets"); // its agent name
	assert.equal(cli.origin, "cli");
	assert.equal(cli.live, true); // written just now
	assert.equal(cli.parseError, null);

	assert.equal(sdk.origin, "rusuban");
	assert.equal(sdk.run, RUN);
	assert.equal(sdk.project, "widgets"); // its run's project, though it ran outside the project's folders

	assert.deepEqual(
		listConversations(index, { project: "widgets" }).map((c) => c.id),
		["unknown-format", "sdk-cli", "cli", "desktop"],
	);
	assert.deepEqual(
		listConversations(index, { item: "acme/widgets#1502" }).map((c) => c.id),
		["cli"],
	);
	assert.deepEqual(
		listConversations(index, { q: "KEYFRAME" }).map((c) => c.id),
		["desktop"],
	);
	assert.deepEqual(listConversations(index, { project: "other" }), []);
});

test("links follow R6's order, and at least 90 % of the sessions about an item are linked to it", async () => {
	placeFixtures();
	const { sessions } = await scanHub({ config, root });
	// SC-003, measured on the fixtures: each one is about the item named here.
	const about = {
		desktop: "acme/widgets#1475",
		cli: "acme/widgets#1502",
		"sdk-cli": "acme/widgets#1475",
	};
	const linked = Object.entries(about).filter(([id, item]) => sessions[id].items.includes(item));
	assert.ok(linked.length / Object.keys(about).length >= 0.9);

	// Its PR link (also its head branch), then the number in its branch's name. Neither the PRs the
	// reminder Claude Code added cites, nor a fork's PR from `main`, the branch it started on.
	assert.deepEqual(sessions.desktop.items, ["acme/widgets#1480", "acme/widgets#1475"]);
	// The PR whose head it is on, the PR it links to, then #1502; #7 names no item of the project.
	assert.deepEqual(sessions.cli.items, [
		"acme/widgets#1490",
		"acme/widgets#1466",
		"acme/widgets#1502",
	]);
	// Its run's item only: the open card its assembled prompt cites is not what it is about.
	assert.deepEqual(sessions["sdk-cli"].items, ["acme/widgets#1475"]);
});

test("a PR found by its head branch stays linked once it has left the open list", async () => {
	placeFixtures();
	await scanHub({ config, root });
	live([], [issue(1475), issue(1502)]);
	const { sessions } = await scanHub({ config, root });
	assert.deepEqual(sessions.cli.items, [
		"acme/widgets#1490",
		"acme/widgets#1466",
		"acme/widgets#1502",
	]);
});

test("a transcript in an unknown format is listed plainly: no title, no link, the reason given", async () => {
	placeFixtures();
	const index = await scanHub({ config, root });
	const plain = listConversations(index, { project: "widgets" }).find(
		(c) => c.id === "unknown-format",
	);
	assert.deepEqual(plain, {
		id: "unknown-format",
		project: "widgets",
		cwd: null,
		title: null,
		origin: null,
		run: null,
		firstAt: null,
		lastAt: "2026-11-05T08:00:00.000Z",
		live: false,
		branch: null,
		prs: [],
		items: [],
		parseError: "unknown format",
	});
});

test("each pass reads only the bytes a transcript gained, and leaves a half-written line for the next", async () => {
	live([pr(1490, "feat/export-presets")], [issue(1502)]);
	const file = place("cli", path.join(work, "widgets"), fixture("cli"));
	let index = await scanHub({ config, root });
	assert.equal(index.files[file].offset, fs.statSync(file).size);
	assert.equal(index.sessions.cli.title, "export-presets");

	// Bytes once read are never read again: spoil the first line, then add a title.
	const bytes = fs.readFileSync(file);
	bytes.fill("x", 0, bytes.indexOf("\n"));
	fs.writeFileSync(file, bytes);
	const retitled = {
		type: "custom-title",
		customTitle: "Export presets, take two",
		sessionId: "cli",
	};
	fs.appendFileSync(file, `${JSON.stringify(retitled)}\n`);
	index = await scanHub({ config, root });
	assert.equal(index.sessions.cli.title, "Export presets, take two");
	assert.equal(index.sessions.cli.parseError, null); // the spoiled line was not read again

	// Half a line waits for the rest of it.
	const link = JSON.stringify({
		type: "pr-link",
		sessionId: "cli",
		prNumber: 1491,
		prUrl: "https://github.com/acme/widgets/pull/1491",
		prRepository: "acme/widgets",
		timestamp: "2026-11-03T14:30:00.000Z",
	});
	const whole = fs.statSync(file).size;
	fs.appendFileSync(file, link.slice(0, 40));
	index = await scanHub({ config, root });
	assert.equal(index.files[file].offset, whole);
	assert.deepEqual(index.sessions.cli.prs, []);
	fs.appendFileSync(file, `${link.slice(40)}\n`);
	index = await scanHub({ config, root });
	assert.deepEqual(
		index.sessions.cli.prs.map((p) => p.n),
		[1491],
	);
	assert.equal(index.files[file].offset, fs.statSync(file).size);

	// A file written over with less is read again from its start.
	fs.writeFileSync(file, fixture("cli"));
	index = await scanHub({ config, root });
	assert.equal(index.sessions.cli.title, "export-presets");
	assert.deepEqual(index.sessions.cli.prs, []);
});

test("a page holds a person's text, Claude's text, tool calls and their results cut to 2 KB", async () => {
	placeFixtures();
	const index = await scanHub({ config, root });
	const page = await readPage(index, "desktop");
	assert.equal(page.before, null); // the whole session fits in one page
	// The injected caveat, the subagent's line and the cut line show nothing.
	assert.deepEqual(
		page.entries.map((e) => e.kind),
		["user", "assistant", "tool", "result", "user", "tool", "result", "assistant"],
	);
	assert.equal(
		page.entries[0].text,
		"The keyframes jitter when I scrub the timeline. Can you find out why and fix it?",
	);
	assert.deepEqual(page.entries[2], {
		kind: "tool",
		at: "2026-11-02T09:14:25.000Z",
		name: "Bash",
		input: "git switch -c fix/1475-keyframes",
	});

	const result = (await readPage(index, "cli")).entries.find((e) => e.kind === "result");
	assert.equal(result.text.length, 2048 + 1);
	assert.ok(result.text.endsWith("…"));
	assert.equal(
		(await readPage(index, "sdk-cli")).entries.find((e) => e.kind === "result").error,
		true,
	);

	assert.equal(await readPage(index, "nobody"), null);
	assert.equal(await readPage(index, "desktop", { before: 10 ** 9 }), null);
});

// The timeout: a cursor that stops moving back would page forever.
const walk = { timeout: 20_000 };
test(
	"pages walk a long transcript back to its start, no line lost or doubled between chunks",
	walk,
	async () => {
		const cwd = path.join(work, "widgets");
		const lines = Array.from({ length: 6000 }, (_, i) =>
			JSON.stringify({
				type: i % 2 ? "assistant" : "user",
				message:
					i % 2
						? { content: [{ type: "text", text: `Reply ${i} ✓ ${"·".repeat(200)}` }] }
						: { content: `Message ${i} é ${"·".repeat(200)}` },
				timestamp: new Date(Date.UTC(2026, 10, 5, 0, 0, i)).toISOString(),
				cwd,
				sessionId: "long",
				entrypoint: "cli",
			}),
		);
		const file = place("long", cwd, `\n${lines.join("\n")}\n\n`); // blank first and last lines
		assert.ok(fs.statSync(file).size > 3 * 2 ** 20); // several chunks each way

		const index = await scanHub({ config, root });
		assert.equal(index.files[file].offset, fs.statSync(file).size);
		assert.equal(
			index.sessions.long.lastAt,
			new Date(Date.UTC(2026, 10, 5, 0, 0, 5999)).toISOString(),
		);
		// One page across every chunk, then small pages each within one.
		const whole = await readPage(index, "long", { limit: 6000 });
		assert.equal(whole.before, null);
		const texts = whole.entries.map((e) => e.text);
		assert.equal(texts.length, 6000);
		assert.ok(texts.every((t, i) => t.startsWith(i % 2 ? `Reply ${i} ✓ ·` : `Message ${i} é ·`)));
		const paged = [];
		let before = null;
		do {
			const page = await readPage(index, "long", { before, limit: 250 });
			paged.unshift(...page.entries.map((e) => e.text));
			before = page.before;
		} while (before !== null);
		assert.deepEqual(paged, texts);
	},
);

test("a title: custom, else agent name, else the one Claude Code wrote, which cites nothing", async () => {
	live([], [issue(7)]);
	const checkout = path.join(work, "widgets");
	const line = (o) => `${JSON.stringify(o)}\n`;
	place(
		"ai",
		checkout,
		said("ai", checkout, "Look at the save path") +
			line({ type: "ai-title", aiTitle: "Save path crash on #7", sessionId: "ai" }) +
			said("ai", checkout, "And the next one"),
	);
	place(
		"named",
		checkout,
		said("named", checkout, "Hello") +
			line({ type: "agent-name", agentName: "Saver" }) +
			line({ type: "ai-title", aiTitle: "Later title", sessionId: "named" }),
	);
	const { sessions } = await scanHub({ config, root });
	assert.equal(sessions.ai.title, "Save path crash on #7");
	assert.deepEqual(sessions.ai.items, []);
	assert.equal(sessions.named.title, "Saver");
});

test("the view: origins as the page names them, a run's title over its prompt, a fork under its session", async () => {
	placeFixtures();
	const checkout = path.join(work, "widgets");
	write(`runs/${RUN}/status.json`, {
		...read(`runs/${RUN}/status.json`),
		title: "Fix the keyframes",
	});
	const REPLY = "reply-20261105-1000-cd34";
	write(`runs/${REPLY}/status.json`, {
		id: REPLY,
		kind: "reply",
		project: "widgets",
		items: ["acme/widgets#1480"],
		session: "fork",
		cwd: checkout,
		forkOf: "desktop",
		title: "Keyframes",
		state: "done",
		createdAt: "2026-11-05T10:00:00.000Z",
	});
	place("fork", checkout, said("fork", checkout, "Also check the easing"));
	const index = await scanHub({ config, root });
	const state = hubState(index, config);
	const by = Object.fromEntries(state.conversations.map((c) => [c.id, c]));
	assert.equal(by["sdk-cli"].title, "Fix the keyframes");
	assert.equal(by["sdk-cli"].origin, "rusuban");
	assert.equal(by["sdk-cli"].runKind, "worker");
	assert.equal(by.desktop.origin, "desktop");
	assert.equal(by.cli.origin, "terminal");
	assert.equal(by.fork.forkOf, "desktop");
	assert.equal(by.fork.title, "Keyframes");
	assert.deepEqual(state.items["acme/widgets#1480"], { type: "pr", title: undefined });
	assert.equal(state.items["acme/widgets#1475"].type, "issue");
	assert.equal(state.indexedAt, index.scannedAt);
	const terminal = hubState(index, config, { origin: "terminal" }).conversations;
	assert.deepEqual(
		terminal.map((c) => c.id),
		["cli"],
	);
});

test("a Rusuban run's conversation is named after the run, never after its prompt", () => {
	const at = "2026-11-10T20:40:00.000Z";
	const clock = new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	assert.equal(runTitle({ kind: "judge", startedAt: at }), `Judge ${clock}`);
	assert.equal(runTitle({ kind: "act", createdAt: at }), `Coordinator ${clock}`);
	assert.equal(runTitle({ kind: "worker", title: "w1328-proof", startedAt: at }), "w1328-proof");
	assert.equal(runTitle({ kind: "task", title: "Daily post", startedAt: at }), "Daily post");
});

test("an answer resumes in place a session whose Rusuban run has ended, and forks any other", async () => {
	placeFixtures();
	const index = await scanHub({ config, root });
	const asked = [];
	const request = (r) => {
		asked.push(r);
		return { id: `reply-${asked.length}` };
	};
	const s = index.sessions["sdk-cli"];
	// The reply goes by its run's name, never by the prompt that opens its session.
	const title = runTitle(read(`runs/${RUN}/status.json`));
	assert.deepEqual(replyTo(index, "sdk-cli", "Go on", request), {
		run: "reply-1",
		forked: false,
		title,
		project: "widgets",
	});
	assert.deepEqual(asked[0], {
		kind: "reply",
		project: "widgets",
		mission: "Go on",
		items: s.items,
		title,
		cwd: s.cwd,
		resume: "sdk-cli",
		fork: false,
		lock: "widgets.reply.sdk-cli",
		trigger: "button",
	});
	assert.equal(replyTo(index, "desktop", "Also this", request).forked, true);
	const running = { state: "running", pid: process.pid }; // a live process
	write(`runs/${RUN}/status.json`, { ...read(`runs/${RUN}/status.json`), ...running });
	assert.equal(replyTo(index, "sdk-cli", "And this", request).forked, true); // its run is at work
	assert.throws(() => replyTo(index, "desktop", "  ", request), { status: 400 });
	assert.throws(() => replyTo(index, "nope", "Hi", request), { status: 404 });
	assert.equal(asked.length, 3);
});

test("a terminal opens on the session's folder, a quote in its path kept, on the runs' model", () => {
	const linux = terminalCommand({ id: "abc", cwd: "/w/it's" }, "claude-test", "linux");
	assert.deepEqual(linux[1], [
		"-e",
		"sh",
		"-c",
		"cd '/w/it'\\''s' && claude --resume abc --model claude-test; exec sh",
	]);
	assert.deepEqual(terminalCommand({ id: "abc", cwd: "C:\\w" }, "claude-test", "win32"), [
		"wt.exe",
		["-d", "C:\\w", "cmd", "/k", "claude --resume abc --model claude-test"],
	]);
	// Without a model, no terminal opens on Claude Code's default.
	const index = { sessions: { abc: { id: "abc", project: "widgets", cwd: "/w" } } };
	const started = [];
	assert.throws(() => openTerminal(index, "abc", undefined, (...a) => started.push(a)), {
		status: 409,
	});
	openTerminal(index, "abc", "claude-test", (...a) => started.push(a));
	assert.equal(started.length, 1);
	assert.match(started[0][1].join(" "), /--model claude-test/);
});

test("a compaction's summary is Claude's: no title, no citation, nothing in the reader", async () => {
	live([], [issue(7), issue(8)]);
	const checkout = path.join(work, "widgets");
	const summary = {
		type: "user",
		isCompactSummary: true,
		isVisibleInTranscriptOnly: true,
		message: { role: "user", content: "Summary: we fixed #7, then looked at #8." },
		timestamp: "2026-11-05T11:00:00.000Z",
		cwd: checkout,
		sessionId: "long",
		entrypoint: "cli",
	};
	place(
		"long",
		checkout,
		said("long", checkout, "Fix #7") +
			`${JSON.stringify(summary)}\n` +
			said("long", checkout, "Go on", "2026-11-05T11:01:00.000Z"),
	);
	const index = await scanHub({ config, root });
	assert.equal(index.version, 2);
	assert.equal(index.sessions.long.title, "Fix #7");
	assert.deepEqual(index.sessions.long.items, ["acme/widgets#7"]);
	const { entries } = await readPage(index, "long");
	assert.deepEqual(
		entries.map((e) => e.text),
		["Fix #7", "Go on"],
	);
});
