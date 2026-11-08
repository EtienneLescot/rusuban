// Click tests of the dashboard (T081): headless Chromium at a desktop width and a phone width. Each
// test starts the real server on a free port, over a seeded instance home (test/e2e/app.mjs).
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "test/e2e",
	testMatch: "*.spec.mjs",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	reporter: "list",
	use: { browserName: "chromium", trace: "retain-on-failure" },
	projects: [
		{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
		{
			name: "phone",
			use: {
				viewport: { width: 390, height: 844 },
				deviceScaleFactor: 2,
				isMobile: true,
				hasTouch: true,
			},
		},
	],
});
