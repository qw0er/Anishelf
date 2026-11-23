import type {
	HistoryResponse,
	SavePlaybackProgressResponse,
} from "@anishelf/contracts/http";
import { expect, type Page, type Request } from "@playwright/test";
import { sampleName, test } from "./fixtures.mts";
import {
	player,
	playFromFiles,
	position,
	seek,
	signIn,
} from "./playback-helpers.mts";

test("plays authenticated media and continues after seeking", async ({
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	const timeline = position(page);
	const playingAt = Number(await timeline.inputValue());
	await seek(page, 0.6);
	await expect
		.poll(async () => Number(await timeline.inputValue()), { timeout: 5_000 })
		.toBeGreaterThan(playingAt + 7_000);
	const seekedAt = Number(await timeline.inputValue());
	await expect
		.poll(async () => Number(await timeline.inputValue()))
		.toBeGreaterThan(seekedAt + 500);
});

test("resumes saved progress from history in a fresh browser session", async ({
	baseURL,
	browser,
	locale,
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	const [save] = await Promise.all([
		page.waitForResponse(
			(response) =>
				response.request().method() === "PUT" &&
				new URL(response.url()).pathname.endsWith("/progress") &&
				response.ok(),
		),
		player(page).press("Space"),
	]);
	const { progress }: SavePlaybackProgressResponse = await save.json();
	expect(progress.positionMs).toBeGreaterThan(1_000);
	await page.close();

	const context = await browser.newContext({ baseURL, locale });
	try {
		const freshPage = await context.newPage();
		const [history] = await Promise.all([
			freshPage.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === "/api/history" && response.ok(),
			),
			signIn(freshPage, "/history", backend.password),
		]);
		const { items }: HistoryResponse = await history.json();
		// Closing the first page can flush a newer position than the pause save.
		const savedAt =
			items.find(({ file }) => file.name === sampleName)?.progress.positionMs ??
			0;
		expect(savedAt).toBeGreaterThanOrEqual(progress.positionMs);
		await freshPage
			.getByRole("link", { name: `Resume: ${sampleName}` })
			.click();
		await expect
			.poll(async () =>
				Math.abs(Number(await position(freshPage).inputValue()) - savedAt),
			)
			.toBeLessThan(500);
	} finally {
		await context.close();
	}
});

test("retries progress after a network failure and resumes the latest saved position", async ({
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	const progressPath = "**/api/playback/sessions/*/progress";
	const failedSave = page.waitForEvent("requestfailed", {
		predicate: (request) => isProgressSave(request),
	});
	await page.route(progressPath, (route) =>
		route.abort("internetdisconnected"),
	);
	await player(page).press("Space");
	await failedSave;
	await seek(page, 0.55);
	await expect
		.poll(async () => Number(await position(page).inputValue()))
		.toBeGreaterThan(11_000);
	await page.unroute(progressPath);

	const [save] = await Promise.all([
		page.waitForResponse(async (response) => {
			if (!response.ok() || !isProgressSave(response.request())) return false;
			const { progress }: SavePlaybackProgressResponse = await response.json();
			return progress.positionMs > 11_000;
		}),
		page.evaluate(() => window.dispatchEvent(new Event("online"))),
	]);
	const { progress }: SavePlaybackProgressResponse = await save.json();
	await resumeFromHistory(page, progress.positionMs);
});

test("saves progress when leaving the playing file through app navigation", async ({
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	const leftAt = Number(await position(page).inputValue());
	const [save] = await Promise.all([
		page.waitForResponse(
			(response) => response.ok() && isProgressSave(response.request()),
		),
		page.getByRole("link", { name: "Back to files", exact: true }).click(),
	]);
	await expect(page).toHaveURL(/\/directories\/root$/);
	const { progress }: SavePlaybackProgressResponse = await save.json();
	expect(progress.positionMs).toBeGreaterThanOrEqual(leftAt - 500);
	await resumeFromHistory(page, progress.positionMs);
});

function isProgressSave(request: Request) {
	return (
		request.method() === "PUT" &&
		new URL(request.url()).pathname.endsWith("/progress")
	);
}

async function resumeFromHistory(page: Page, savedAt: number) {
	await page.goto("/history");
	await page.getByRole("link", { name: `Resume: ${sampleName}` }).click();
	await expect
		.poll(async () =>
			Math.abs(Number(await position(page).inputValue()) - savedAt),
		)
		.toBeLessThan(500);
}
