import { defineConfig } from "@playwright/test";
import webConfig from "./playwright.config.js";

export default defineConfig({
	...webConfig,
	testIgnore: [],
	testMatch: "**/*.desktop.spec.mts",
	outputDir: ".temp/playwright-desktop-results",
});
