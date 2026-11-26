import { setTimeout as delay } from "node:timers/promises";
import { expect } from "@playwright/test";
import { sampleName, test } from "./fixtures.mts";
import { signIn } from "./playback-helpers.mts";

test("shows the destination before a slow directory listing arrives", async ({
	page,
	backend,
}, testInfo) => {
	await signIn(page, "/settings", backend.password);
	const { promise: shellObserved, resolve: releaseListing } =
		Promise.withResolvers<void>();
	await page.route(
		"**/api/directories/root",
		async (route) => {
			await Promise.all([delay(2_000), shellObserved]);
			await route.continue();
		},
		{ times: 1 },
	);

	const sample = page.getByRole("link", { name: sampleName, exact: true });
	const clickedAt = performance.now();
	let shellMs: number;
	try {
		await page.getByRole("link", { name: "Files", exact: true }).click();
		await expect(page).toHaveURL(/\/directories\/root$/);
		await expect(
			page.getByRole("status", { name: "Loading files…" }),
		).toBeVisible();
		await expect(sample).toHaveCount(0);
		shellMs = Math.round(performance.now() - clickedAt);
	} finally {
		releaseListing();
	}
	await expect(sample).toBeVisible();
	await testInfo.attach("directory navigation timings", {
		body: JSON.stringify({
			shellMs,
			listingMs: Math.round(performance.now() - clickedAt),
		}),
		contentType: "application/json",
	});
});
