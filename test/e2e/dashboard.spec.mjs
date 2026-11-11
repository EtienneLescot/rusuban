// What a person does on the dashboard, with real clicks on a desktop and real taps on a phone: both
// go through the page's own hit-testing, which is what let the view tabs of #7 ship dead.
import { expect } from "@playwright/test";
import { loadConfig, read, readJsonl, saveConfig } from "../../src/home.mjs";
import { answerOf, askDesktop } from "../../src/machines.mjs";
import { changeSetting } from "../../src/settings.mjs";
import { test } from "./app.mjs";

const VIEWS = {
	graph: "#vp",
	kanban: "#kanban",
	conversations: "#conversations",
	agents: "#agents-view",
};
const press = (locator, isMobile) => (isMobile ? locator.tap() : locator.click());

// The page's main area shows that view, and only that one.
async function showing(page, view) {
	for (const [name, selector] of Object.entries(VIEWS))
		if (name === view) await expect(page.locator(selector)).toBeVisible();
		else await expect(page.locator(selector)).toBeHidden();
}

// A phone opens on its inbox. Conversations and Agents are tabs of their own; the graph tab shows
// the graph or the kanban, picked in its row of view tabs.
async function goTo(page, view, isMobile) {
	if (!isMobile) return press(page.locator(`.views [data-view="${view}"]`), false);
	if (view === "graph" || view === "kanban") {
		await press(page.locator('#tabbar [data-tab="graph"]'), true);
		return press(page.locator(`.views [data-view="${view}"]`), true);
	}
	return press(page.locator(`#tabbar [data-tab="${view}"]`), true);
}

test("each view tab shows its view", async ({ page, isMobile }) => {
	if (isMobile) {
		await expect(page.locator("#inbox")).toBeVisible();
		await expect(page.locator(".main-area")).toBeHidden();
	}
	// The phone's first tab is named after the view it shows, graph or kanban.
	const board = page.locator('#tabbar [data-tab="graph"]');
	for (const view of ["kanban", "conversations", "agents", "graph"]) {
		await goTo(page, view, isMobile);
		await showing(page, view);
		if (isMobile) await expect(page.locator("#inbox")).toBeHidden();
		else
			await expect(page.locator(`.views [data-view="${view}"]`)).toHaveAttribute(
				"aria-selected",
				"true",
			);
		if (isMobile && view === "kanban") await expect(board).toHaveText("Kanban");
	}
	if (isMobile) {
		await expect(board).toHaveText("Graph");
		// Agents picked in the first tab's row of view tabs: the tab bar follows to its own tab.
		await press(page.locator('.views [data-view="agents"]'), true);
		await showing(page, "agents");
		await expect(page.locator('#tabbar [data-tab="agents"]')).toHaveAttribute(
			"aria-current",
			"page",
		);
		await press(page.locator('#tabbar [data-tab="inbox"]'), true);
		await expect(page.locator("#inbox")).toBeVisible();
		await expect(page.locator(".main-area")).toBeHidden();
	}
});

test("a card opens and closes; the inbox holds both projects' cards", async ({
	app,
	page,
	isMobile,
}) => {
	await expect(page.locator(".ibx-item")).toHaveCount(2);
	const projects = await page.locator(".ibx-item .ibx-project").allInnerTexts();
	expect(projects.sort()).toEqual(["Acme", "Orbit"]);
	await press(page.locator(`.ibx-item[data-card="${app.cards.acme}"]`), isMobile);
	await expect(page.locator("article.cv .cv-q")).toHaveText("Build dark mode?");
	await expect
		.poll(() => decodeURIComponent(new URL(page.url()).hash))
		.toBe(`#card/${app.cards.acme}`);
	if (isMobile) await expect(page.locator("#tabbar")).toBeHidden();
	await press(page.locator("[data-back]"), isMobile);
	await expect(page.locator("article.cv")).toHaveCount(0);
	await expect(page.locator(".ibx-list")).toBeVisible();
	if (isMobile) await expect(page.locator("#tabbar")).toBeVisible();
});

test("answering an option takes the card off the list to answer, into answers.jsonl", async ({
	app,
	page,
	isMobile,
}) => {
	const count = page.locator('[data-queue="decisions"] b');
	await expect(count).toHaveText("2");
	await press(page.locator(`.ibx-item[data-card="${app.cards.acme}"]`), isMobile);
	const other = page.locator('[data-option="close"]');
	await press(other, isMobile);
	await expect(other).toHaveAttribute("aria-pressed", "true");
	await press(page.locator("[data-send]"), isMobile);
	await expect(page.locator("#toast")).toHaveText("Answer sent");
	await expect(page.locator(".done-box")).toContainText("Answered: “Close it”");
	await expect(page.locator("[data-option]")).toHaveCount(0);
	expect(readJsonl("projects/acme/answers.jsonl")).toMatchObject([
		{ item: "acme/widgets#21", card: app.cards.acme, option: "close", by: "alice" },
	]);
	expect(readJsonl("projects/orbit/answers.jsonl")).toEqual([]);
	await press(page.locator("[data-back]"), isMobile);
	await expect(page.locator(`.ibx-item[data-card="${app.cards.acme}"]`)).toHaveClass(/answered/);
	await expect(count).toHaveText("1");
});

test("Rules & settings: a tab of the inbox for how the agents follow the projects", async ({
	app,
	page,
	isMobile,
}) => {
	const tab = (q) => page.locator(`.ibx-seg [data-queue="${q}"]`);
	await expect(tab("decisions")).toHaveAttribute("aria-selected", "true");
	await expect(tab("decisions")).toHaveText("Decisions 2");
	await expect(tab("rules")).toHaveText("Rules & settings 2");
	await press(tab("rules"), isMobile);
	await expect(tab("rules")).toHaveAttribute("aria-selected", "true");
	// The lock to lift and the rule proposal, each tagged; then the PR that changes .rusuban/.
	const items = page.locator("button.ibx-item");
	await expect(items).toHaveCount(2);
	// Both were seeded in the same instant on a fast machine: their order is not the test's.
	expect((await items.locator(".tag").allInnerTexts()).sort()).toEqual(["Lock", "Rule proposal"]);
	const proposal = page.locator(`.ibx-item[data-card="${app.cards.rule}"]`);
	await expect(proposal.locator(".ibx-meta")).toContainText("Rule proposal");
	await expect(proposal.locator(".ibx-meta")).toContainText("2 cards");
	const rulesPr = page.locator("a.ibx-item");
	await expect(rulesPr).toContainText("A rule for theme requests");
	await expect(rulesPr).toContainText("CI green");
	await expect(rulesPr).toHaveAttribute("href", "https://github.com/acme/widgets/pull/14");

	await press(page.locator(`.ibx-item[data-card="${app.cards.rule}"]`), isMobile);
	await expect(page.locator("[data-back]")).toHaveText("Rules & settings");
	await expect(page.locator(".cv-chips .tag").first()).toHaveText("Rule proposal");
	await expect(page.locator(".rule-text")).toHaveText(
		"A theme request waits for a design before anyone builds it.",
	);
	await expect(page.locator(".rule-file")).toHaveText("Added to .rusuban/rules/02-themes.md");
	await expect(page.locator(".seen")).toHaveText("Seen on #21#13");
	await expect(page.locator(".cv-opt b")).toHaveText(["Open the rule PR", "Not a rule"]);
	await expect(page.locator(".cv-opt.rec .badge")).toHaveText("Recommended");
	if (!isMobile)
		await expect(page.locator(".cv-free-label")).toHaveText("Or change the rule in your own words");
	await press(page.locator('[data-option="open"]'), isMobile);
	await press(page.locator("[data-send]"), isMobile);
	await expect(page.locator("#toast")).toHaveText("Answer sent");
	expect(readJsonl("projects/acme/answers.jsonl")).toMatchObject([
		{ item: app.cards.rule, card: app.cards.rule, option: "open", by: "alice" },
	]);
	// Back from it is its queue, and the item a card stands for opens from "Seen on".
	await press(page.locator("[data-back]"), isMobile);
	await expect(tab("rules")).toHaveAttribute("aria-selected", "true");
	await press(page.locator(`.ibx-item[data-card="${app.cards.rule}"]`), isMobile);
	await press(page.locator(".seen [data-card]").first(), isMobile);
	await expect(page.locator("article.cv .cv-q")).toHaveText("Build dark mode?");
	await expect(page.locator("[data-back]")).toHaveText("Inbox");
	await press(page.locator("[data-back]"), isMobile);
	await expect(tab("decisions")).toHaveAttribute("aria-selected", "true");
	// The PR that changes .rusuban/ is neither in the graph nor in the kanban.
	await goTo(page, "kanban", isMobile);
	await expect(page.locator("#kanban")).toContainText("Raise the upload limit");
	await expect(page.locator("#kanban")).not.toContainText("A rule for theme requests");
	if (!isMobile) {
		await goTo(page, "graph", isMobile);
		await expect(page.locator('[data-id="acme/widgets#13"]')).toHaveCount(1);
		await expect(page.locator('[data-id="acme/widgets#14"]')).toHaveCount(0);
	}
});

test("an item's card answers its card as the inbox does, then takes a request to Claude", async ({
	app,
	page,
	isMobile,
}) => {
	// Tall enough for the whole card: the graph pans, it does not scroll.
	await page.setViewportSize(
		isMobile ? { width: 375, height: 2400 } : { width: 1440, height: 1600 },
	);
	await goTo(page, "kanban", isMobile);
	await press(page.locator('.card-open[data-focus="acme/widgets#21"]'), isMobile);
	const node = page.locator('[data-id="acme/widgets#21"]');
	const card = node.locator(`[data-answer="${app.cards.acme}"]`);
	await expect(card.locator(".cv-q")).toHaveText("Build dark mode?");
	await expect(card.locator(".cv-opt b")).toHaveText(["Build it", "Close it"]);
	await expect(card.locator(".cv-opt.rec .badge")).toHaveText("Recommended");
	await expect(node.locator(".ask")).toHaveCount(0);
	const close = card.locator('[data-option="close"]');
	await press(close, isMobile);
	await expect(close).toHaveAttribute("aria-pressed", "true");
	await press(card.locator("[data-send]"), isMobile);
	await expect(page.locator("#toast")).toHaveText("Answer sent");
	expect(readJsonl("projects/acme/answers.jsonl")).toMatchObject([
		{ item: "acme/widgets#21", card: app.cards.acme, option: "close", by: "alice" },
	]);
	await expect(card.locator(".done-box")).toContainText("Answered: “Close it”");
	// Answered, the item takes a request in words, which goes to the coordinator with the item.
	const ask = node.locator(".ask");
	await ask.locator("textarea").fill("Thank the reporter when you close it.");
	await press(ask.locator("[data-send-ask]"), isMobile);
	await expect(page.locator("#toast")).toHaveText("Sent to the coordinator");
	expect(readJsonl("projects/acme/asks.jsonl")).toMatchObject([
		{ item: "acme/widgets#21", text: "Thank the reporter when you close it.", by: "alice" },
	]);
	await expect(ask.locator("textarea")).toHaveValue("");
	// Nothing in the card is wider than it, at a phone's width as on a desktop.
	const over = await node.evaluate((el) => {
		const right = el.querySelector(".detail").getBoundingClientRect().right;
		return [...el.querySelectorAll(".detail *")]
			.filter((x) => x.getBoundingClientRect().right > right + 0.5)
			.map((x) => `${x.tagName} ${x.className}`);
	});
	expect(over).toEqual([]);
});

test("a filter changes the list", async ({ page, isMobile }) => {
	await goTo(page, "kanban", isMobile);
	// Yours, the agents' (newest first), then those waiting on others.
	const labels = page.locator("#kanban .card-open b");
	await expect(labels).toHaveText([
		"Dark mode",
		"Raise the upload limit",
		"Install docs",
		"Fix the crash on save",
		"Crash when offline",
	]);
	await press(page.locator('#kind-chips [data-kind="bug"]'), isMobile);
	await expect(page.locator('#kind-chips [data-kind="bug"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(labels).toHaveText(["Fix the crash on save", "Crash when offline"]);
	await press(page.locator('#kind-chips [data-kind="all"]'), isMobile);
	await press(page.locator('#own-chips [data-own="mine"]'), isMobile);
	await expect(labels).toHaveText(["Dark mode", "Raise the upload limit"]);
});

test("Agents: Run now on a task at rest, none on a task at work", async ({ page, isMobile }) => {
	await goTo(page, "agents", isMobile);
	const runNow = (task) => page.locator(`[data-run-task="${task}"]`);
	await expect(runNow("digest")).toBeVisible();
	await expect(runNow("release")).toHaveCount(0);
	await expect(page.locator(".ag-run").filter({ hasText: "Release notes" })).toBeVisible();
	// Run now starts the task through the real runner, fake-claude in place of claude.
	await press(runNow("digest"), isMobile);
	await expect(page.locator("#toast")).toHaveText("Weekly digest started");
	await expect(runNow("digest")).toHaveCount(0);
	await expect(page.locator(".ag-run").filter({ hasText: "Weekly digest" })).toBeVisible();
	// The model its session announced, the one asked for: it comes once two processes have started,
	// the runner and fake-claude, which a loaded machine can take longer than 5 s to do.
	await expect(page.locator("#agents-view .ag-model").first()).toHaveText("claude-test", {
		timeout: 20_000,
	});
	await expect(page.locator("#agents-view .ag-model.off")).toHaveCount(0);
});

test("without a model the page says no run starts, and Run now is refused", async ({
	page,
	isMobile,
}) => {
	await expect(page.locator("#nomodel")).toBeHidden();
	saveConfig({ ...loadConfig(), model: undefined });
	await expect(page.locator("#nomodel")).toBeVisible();
	await goTo(page, "agents", isMobile);
	await press(page.locator('[data-run-task="digest"]'), isMobile);
	await expect(page.locator("#toast")).toContainText("No model is set for the runs");
});

test("a setting asked from Claude waits as a card, and applies once the owner allows it", async ({
	page,
	isMobile,
}) => {
	changeSetting(
		{ kind: "project.bypass", project: "acme", on: true },
		{ origin: "mcp", by: "alice" },
	);
	// A setting is about how the agents follow the projects: it waits in Rules & settings.
	await press(page.locator('[data-queue="rules"]'), isMobile);
	const item = page.locator(".ibx-item", {
		hasText: "Let the server merge with your bypass on acme?",
	});
	await press(item, isMobile);
	await expect(page.locator(".cv-chips")).toContainText("Setting");
	await expect(page.locator("[data-back]")).toHaveText("Rules & settings");
	await expect(page.locator(".cv-ctx")).toContainText("Asked from Claude, through the MCP");
	// Allowed or not, never answered in words, and nothing is recommended.
	await expect(page.locator("#cv-free")).toHaveCount(0);
	await expect(page.locator(".cv-opt .badge")).toHaveCount(0);
	await expect(page.locator(".cv-opt b")).toHaveText(["Allow it", "Don't allow it"]);
	expect(read("config.json").projects[0].bypassApproval).toBe(false);
	await press(page.locator('[data-option="allow"]'), isMobile);
	await press(page.locator("[data-send]"), isMobile);
	await expect(page.locator("#toast")).toHaveText("Answer sent");
	await expect(item).toHaveCount(0);
	await expect(page.locator(".ibx-list").first()).toBeVisible();
	expect(read("config.json").projects[0].bypassApproval).toBe(true);
});

test("Conversations: by item, filtered by origin; the reader shows one and answers it in a fork", async ({
	page,
	isMobile,
}) => {
	await goTo(page, "conversations", isMobile);
	const list = page.locator("#conv-list");
	await expect(list.locator(".cl-row")).toHaveCount(2);
	await expect(list.locator(".cl-ghead").first()).toContainText("PR #11");
	await press(list.locator('[data-origin="terminal"]'), isMobile);
	await expect(list.locator(".cl-row")).toHaveCount(1);
	await expect(list.locator(".cl-row")).toContainText("Reproduce #22 offline.");
	await press(list.locator('[data-origin="all"]'), isMobile);
	await press(list.locator(".cl-row", { hasText: "Fix the crash on save" }), isMobile);
	const reader = page.locator("#conv-reader");
	await expect(reader.locator("h1")).toHaveText("Fix the crash on save");
	await expect(reader.locator(".cr-live")).toHaveText("Live in Claude Desktop");
	await expect(reader.locator(".cr-tool b")).toHaveText("Bash");
	await expect(reader.locator(".cr-tool pre")).toHaveText("1 failing: save without a folder");
	// A terminal opens a window of this machine: offered on a desktop only.
	await expect(reader.locator("[data-terminal]")).toHaveCount(isMobile ? 0 : 1);
	await reader.locator("#cr-text").fill("Also check the folder rights.");
	const send = reader.locator("[data-reply]");
	await expect(send).toHaveText("Answer in a fork");
	await press(send, isMobile);
	await expect(page.locator("#toast")).toHaveText("Answered in a fork");
	await expect(reader.locator("#cr-text")).toHaveValue("");
	await expect
		.poll(() => readJsonl("projects/acme/journal.jsonl").map((e) => e.text))
		.toContain("Answered the conversation “Fix the crash on save” in a fork");
});

test("a project without a repo shows its tasks and runs, never an empty board, and reads no GitHub", async ({
	page,
	isMobile,
}) => {
	// On a phone the project switcher is in the menu.
	const pick = async (id) => {
		if (isMobile) await press(page.locator("#menu"), true);
		await page.selectOption("#project", id);
		if (isMobile) await press(page.locator("#menu"), true);
	};
	await pick("publications");
	const boards = page.locator('.views [data-view="graph"], .views [data-view="kanban"]');
	if (isMobile) {
		await expect(page.locator('#tabbar [data-tab="graph"]')).toBeHidden();
		await press(page.locator('#tabbar [data-tab="agents"]'), true);
	} else await expect(boards).toHaveCount(2);
	await showing(page, "agents");
	for (const b of await boards.all()) await expect(b).toBeHidden();
	await expect(page.locator("#agents-view")).toContainText("Daily post");
	await expect(page.locator("#fresh")).toBeHidden();
	await expect(page.locator("#observe")).toBeHidden();
	await goTo(page, "conversations", isMobile);
	await showing(page, "conversations");
	// Back on a project with a repo, its board is there again.
	await pick("acme");
	await goTo(page, "graph", isMobile);
	await showing(page, "graph");
	if (!isMobile) await expect(page.locator("#fresh")).toBeVisible();
});

test("each project's section shows only its own tasks, runs and conversations", async ({
	page,
	isMobile,
}) => {
	const pick = async (id) => {
		if (isMobile) await press(page.locator("#menu"), true);
		await page.selectOption("#project", id);
		if (isMobile) await press(page.locator("#menu"), true);
	};
	const agents = page.locator("#agents-view");
	const tasks = agents.locator(".ag-task-name b");
	const rows = page.locator("#conv-list .cl-row");
	// A task naming a project the instance lacks shows in each section, with its error.
	const orphan = `project "letters" is none of this instance's: acme, orbit, publications`;
	// Acme's: its tasks and its machines; no row names its project.
	await goTo(page, "agents", isMobile);
	await expect(tasks).toHaveText(["Weekly digest", "Newsletter", "Release notes"]);
	await expect(agents.locator(".ag-err")).toHaveText(orphan);
	await expect(agents.locator('section[aria-label="Machines"]')).toBeVisible();
	await expect(agents.locator(".ag-line")).toHaveCount(0);
	await expect(agents).not.toContainText("Acme");
	await expect(page.locator("#agents-label")).toContainText("Release notes");
	await goTo(page, "conversations", isMobile);
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: "Daily post" })).toHaveCount(0);
	// Publications': its conversation, its task and run, no machines; the header's run is its own.
	await pick("publications");
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText("Daily post");
	await goTo(page, "agents", isMobile);
	await expect(tasks).toHaveText(["Newsletter", "Daily post"]);
	await expect(agents.locator(".ag-err")).toHaveText(orphan);
	await expect(agents.locator('section[aria-label="Machines"]')).toHaveCount(0);
	await expect(agents.locator(".ag-line")).toHaveCount(1);
	await expect(agents.locator(".ag-line")).toContainText("Posted the release thread.");
	await expect(agents).not.toContainText("Release notes");
	await expect(page.locator("#agents-label")).not.toContainText("Release notes");
});

test("a project without rules says so under the view tabs, with how to add rules", async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, "the project switcher is the desktop's");
	await expect(page.locator("#observe")).toBeHidden(); // acme has its rules
	await page.selectOption("#project", "orbit");
	const banner = page.locator("#observe");
	await expect(banner).toBeVisible();
	await expect(banner.locator("b")).toHaveText("Observe only");
	await expect(page.locator(".main-card")).toContainText("people merge");
	await expect(page.locator("#observe-text")).toHaveText(
		"No rules in .rusuban/rules/ on main: agents read this project and never act.",
	);
	await expect(banner.getByRole("link", { name: "Rule examples ↗" })).toHaveAttribute(
		"href",
		/\/examples\/rules$/,
	);
	await expect(banner.getByRole("link", { name: "How rules work ↗" })).toHaveAttribute(
		"href",
		/\/docs\/writing-rules\.md$/,
	);
});

test("Machines: a card each, its state said; Release, pressed twice, ends a lease", async ({
	page,
	isMobile,
}) => {
	await goTo(page, "agents", isMobile);
	const machines = page.locator('section[aria-label="Machines"]');
	await expect(machines.locator(".mc")).toHaveCount(3);
	await expect(machines.locator("#machine-mac .mc-state")).toContainText(
		"Held by worker-20261108-1000-ab12",
	);
	await expect(machines.locator("#machine-desk .mc-desk")).toHaveText("alice's desktop");
	await expect(machines.locator("#machine-desk .mc-state")).toHaveText(
		"Free · each lease asks alice first.",
	);
	await expect(machines.locator("#machine-ci .mc-state")).toHaveText(
		"Offline: ssh: connect to host ci port 22: Connection timed out.",
	);
	await expect(machines.locator("[data-release]")).toHaveCount(1);
	const release = machines.locator('[data-release="mac"]');
	await press(release, isMobile);
	await expect(release).toHaveText("Release it?");
	await press(release, isMobile);
	await expect(page.locator("#toast")).toHaveText("mac released");
});

test("a desktop a run asks for: a card in the inbox, lent or not, never answered in words", async ({
	page,
	isMobile,
}) => {
	await askDesktop({
		run: "worker-20261108-1100-cd34",
		project: "acme",
		reason: "Measure the export on a real screen",
		asks: [{ machine: "desk", owner: "alice" }],
	});
	const item = page.locator(".ibx-item", { hasText: "Can a run take your desktop desk?" });
	await press(item, isMobile);
	await expect(page.locator(".cv-chips")).toContainText("Machine");
	await expect(page.locator(".cv-ctx")).toContainText("Measure the export on a real screen");
	await expect(page.locator("#cv-free")).toHaveCount(0);
	await expect(page.locator(".cv-opt b")).toHaveText(["Lend it", "Not now"]);
	await press(page.locator('[data-option="allow"]'), isMobile);
	await press(page.locator("[data-send]"), isMobile);
	await expect(page.locator("#toast")).toHaveText("Answer sent");
	await expect(item).toHaveCount(0);
	expect(answerOf("worker-20261108-1100-cd34", "desk")?.yes).toBe(true);
});

test("a node's top row takes nothing from the page's header: no square corner past its rounding", async ({
	page,
	isMobile,
}) => {
	await goTo(page, "graph", isMobile);
	const row = page.locator(".node .row.top").first();
	await expect(row).toBeVisible();
	const style = await row.evaluate((e) => {
		const s = getComputedStyle(e);
		return { bg: s.backgroundColor, border: s.borderBottomStyle };
	});
	expect(style).toEqual({ bg: "rgba(0, 0, 0, 0)", border: "none" });
});
