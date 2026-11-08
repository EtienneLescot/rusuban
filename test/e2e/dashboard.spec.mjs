// What a person does on the dashboard, with real clicks on a desktop and real taps on a phone: both
// go through the page's own hit-testing, which is what let the view tabs of #7 ship dead.
import { expect } from "@playwright/test";
import { read, readJsonl } from "../../src/home.mjs";
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
	const count = page.locator(".ibx-head .amber");
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

test("a filter changes the list", async ({ page, isMobile }) => {
	await goTo(page, "kanban", isMobile);
	// Yours, the agents' (newest first), then those waiting on others.
	const labels = page.locator("#kanban .card-open b");
	await expect(labels).toHaveText([
		"Dark mode",
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
	await expect(labels).toHaveText(["Dark mode"]);
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
});

test("a setting asked from Claude waits as a card, and applies once the owner allows it", async ({
	page,
	isMobile,
}) => {
	changeSetting(
		{ kind: "project.bypass", project: "acme", on: true },
		{ origin: "mcp", by: "alice" },
	);
	const item = page.locator(".ibx-item", {
		hasText: "Let the server merge with your bypass on acme?",
	});
	await press(item, isMobile);
	await expect(page.locator(".cv-chips")).toContainText("Setting");
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
	await expect(page.locator(".ibx-list")).toBeVisible();
	expect(read("config.json").projects[0].bypassApproval).toBe(true);
});
