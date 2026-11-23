import { expect } from "@playwright/test";
import { embeddedCue, test } from "./fixtures.mts";
import {
	player,
	playFromFiles,
	position,
	seek,
	selectSubtitle,
	styledSubtitleFrame,
} from "./playback-helpers.mts";

test.use({ media: "subtitles" });

test("renders the selected embedded SRT cue during playback", async ({
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	await selectSubtitle(page, /Embedded SRT/i);
	await expect(
		player(page).getByText(embeddedCue, { exact: true }),
	).toBeVisible();
});

test("renders the selected embedded cue after a paused seek", async ({
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	await player(page).press("Space");
	await selectSubtitle(page, /Embedded SRT/i);
	const cue = player(page).getByText(embeddedCue, { exact: true });
	await expect(cue).toBeHidden();
	await seek(page, 0.45);
	await expect
		.poll(async () => Number(await position(page).inputValue()))
		.toBeGreaterThan(7_000);
	await expect(player(page).locator(".lmp-transport")).toHaveAttribute(
		"aria-label",
		"Play",
	);
	// The bundled player misses the active embedded SRT cue after a paused seek.
	test.fail(true, "Embedded SRT cue is missing after seeking while paused");
	await expect(cue).toBeVisible({ timeout: 3_000 });
});

test("renders the external ASS cue in the styled subtitle canvas", async ({
	page,
	backend,
}) => {
	await playFromFiles(page, backend.password);
	await player(page).press("Space");
	await selectSubtitle(page, /external/i);
	const blank = await styledSubtitleFrame(page);
	await player(page).locator(".lmp-transport").click();
	await expect
		.poll(async () => (await styledSubtitleFrame(page)).equals(blank))
		.toBe(false);
	await player(page).locator(".lmp-transport").click();
	await seek(page, 0.8);
	await expect
		.poll(async () => (await styledSubtitleFrame(page)).equals(blank))
		.toBe(true);
});
