import type {
	HistoryResponse,
	SavePlaybackProgressResponse,
} from "@anishelf/contracts/http";
import { expect, type Page } from "@playwright/test";
import { sampleName, test } from "./fixtures.mts";

async function signIn(page: Page, path: string, password: string) {
	await page.goto(path);
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page).toHaveURL((url) => url.pathname === path);
}

function player(page: Page) {
	return page.getByRole("region", { name: `Video: ${sampleName}` });
}

function position(page: Page) {
	return player(page).getByRole("slider", { name: "Seek", exact: true });
}

async function playFromFiles(page: Page, password: string) {
	await signIn(page, "/directories/root", password);
	await page.getByRole("link", { name: sampleName, exact: true }).click();
	await expect(position(page)).toHaveAttribute("max", /^[1-9]\d*$/);
	await expect(player(page)).not.toHaveAttribute("aria-busy", "true");
	await player(page).press("Space");
	await expect
		.poll(async () => Number(await position(page).inputValue()))
		.toBeGreaterThan(2_000);
}

test("plays authenticated media and continues after seeking", async ({
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	const timeline = position(page);
	await player(page).hover();
	await timeline.scrollIntoViewIfNeeded();
	const bounds = await timeline.boundingBox();
	if (!bounds) throw new Error("Playback timeline is not visible.");
	const playingAt = Number(await timeline.inputValue());
	await page.mouse.click(
		bounds.x + bounds.width * 0.6,
		bounds.y + bounds.height / 2,
	);
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
