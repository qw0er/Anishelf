import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	outputDir: ".temp/playwright-results",
	forbidOnly: Boolean(process.env.CI),
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: {
		...devices["Desktop Chrome"],
		locale: "en-US",
		trace: "retain-on-failure",
	},
});
