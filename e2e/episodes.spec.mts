import { readFile } from "node:fs/promises";
import type {
	AuthSessionResponse,
	SavePlaybackProgressRequest,
	TrackingPreviewResponse,
} from "@anishelf/contracts/http";
import { expect, type Page } from "@playwright/test";
import {
	fixtureWork,
	fixtureWorkId,
	sampleName,
	secondEpisode,
	test,
} from "./fixtures.mts";
import {
	player,
	position,
	seek,
	signIn,
	waitForPlayer,
} from "./playback-helpers.mts";

test.use({ media: "episodes" });

async function connectTracking(page: Page, origin: string) {
	const session = await page.request.get("/api/auth/session");
	await expect(session).toBeOK();
	const { csrfToken }: AuthSessionResponse = await session.json();
	if (!csrfToken) throw new Error("Missing CSRF token after sign-in.");
	const headers = { origin, "x-csrf-token": csrfToken };
	const preview = await page.request.post("/api/tracking/account/preview", {
		headers,
		data: { providerKey: "bangumi", credential: "playwright-fixture-token" },
	});
	await expect(preview).toBeOK();
	const { candidateId, generation }: TrackingPreviewResponse =
		await preview.json();
	const confirmation = await page.request.post(
		"/api/tracking/account/confirm",
		{
			headers,
			data: { candidateId, generation },
		},
	);
	await expect(confirmation).toBeOK();
}

async function confirmEpisode(page: Page, fileName: string, number: string) {
	await page.getByRole("link", { name: "Review", exact: true }).click();
	const row = page.getByRole("listitem").filter({ hasText: fileName });
	await row.getByRole("link", { name: "Inspect resource" }).click();
	await page
		.getByLabel("Provider ID or work URL")
		.fill(`https://bgm.tv/subject/${fixtureWorkId}`);
	await page.getByRole("button", { name: "Look up", exact: true }).click();
	await page.getByLabel("Episode numbers").fill(number);
	const reason = page.getByLabel("Correction reason");
	if (await reason.isVisible())
		await reason.fill("Confirmed fixture episode number");
	await page
		.getByRole("button", { name: "Preview association", exact: true })
		.click();
	await expect(
		page.getByText(`Episode ${number}`, { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Confirm association", exact: true })
		.click();
	await page.getByRole("button", { name: "Open anime", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: fixtureWork, exact: true }),
	).toBeVisible();
}

test("confirms episode associations, records a natural completion and plays the next episode on request", async ({
	page,
	backend,
}) => {
	test.setTimeout(120_000);
	await signIn(page, "/review", backend.password);
	await confirmEpisode(page, sampleName, "1");
	await confirmEpisode(page, secondEpisode, "2");

	await page.getByRole("link", { name: "Library", exact: true }).click();
	await page.getByRole("link", { name: fixtureWork, exact: true }).click();
	await expect(
		page.getByRole("link", { name: "Play: Episode 2", exact: true }),
	).toBeVisible();
	await connectTracking(page, backend.origin);
	await page
		.getByRole("link", { name: "Play: Episode 1", exact: true })
		.click();
	const first = `${fixtureWork} — Episode 1`;
	const second = `${fixtureWork} — Episode 2`;
	await waitForPlayer(page, first);
	await expect(player(page, first).locator(".lmp-transport")).toHaveAttribute(
		"aria-label",
		"Play",
	);

	const nearEnd = page.waitForResponse((response) => {
		if (!response.ok() || !response.url().endsWith("/progress")) return false;
		const body: SavePlaybackProgressRequest = response.request().postDataJSON();
		return !!body.durationMs && body.positionMs / body.durationMs > 0.87;
	});
	await seek(page, 0.95, first);
	await nearEnd;
	const completionCount = async () =>
		(await readFile(backend.logPath, "utf8")).split(
			'"event":"playback.completion_queued"',
		).length - 1;
	expect(await completionCount()).toBe(0);

	await seek(page, 0, first);
	await expect
		.poll(async () => Number(await position(page, first).inputValue()))
		.toBeLessThan(500);
	const naturalEnd = page.waitForResponse(
		(response) => {
			if (!response.ok() || !response.url().endsWith("/progress")) return false;
			const body: SavePlaybackProgressRequest = response
				.request()
				.postDataJSON();
			return body.naturalEnd === true && (body.normalPlayedMs ?? 0) >= 30_000;
		},
		{ timeout: 50_000 },
	);
	await player(page, first).locator(".lmp-transport").click();
	await naturalEnd;
	await expect.poll(completionCount).toBe(1);
	await expect(player(page, first).locator(".lmp-transport")).toHaveAttribute(
		"aria-label",
		"Replay",
	);
	await expect(player(page, second)).toHaveCount(0);

	await player(page, first)
		.getByRole("button", { name: "Next: Episode 2", exact: true })
		.click();
	await waitForPlayer(page, second);
	await expect
		.poll(async () => Number(await position(page, second).inputValue()))
		.toBeGreaterThan(2_000);
});
