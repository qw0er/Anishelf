import { expect } from "@playwright/test";
import { sampleName, test } from "./fixtures.mts";
import { signIn, startPlayback } from "./playback-helpers.mts";

test.use({ configured: false });

test("adds the first resource directory and plays a file after the automatic scan", async ({
	page,
	backend,
}) => {
	await signIn(page, "/settings", backend.password);
	await page
		.getByLabel("New resource directory path")
		.fill(backend.mediaDirectory);
	await page
		.getByRole("button", { name: "Add directory", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Save directories", exact: true })
		.click();
	await expect(page).toHaveURL(/\/directories\/root$/);
	await page.getByRole("link", { name: sampleName, exact: true }).click();
	await startPlayback(page);
});
