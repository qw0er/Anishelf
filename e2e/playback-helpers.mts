import { expect, type Page } from "@playwright/test";
import { sampleName } from "./fixtures.mts";

export async function signIn(page: Page, path: string, password: string) {
	await page.goto(path);
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page).toHaveURL((url) => url.pathname === path);
}

export function player(page: Page, name = sampleName) {
	return page.getByRole("region", { name: `Video: ${name}` });
}

export function position(page: Page, name = sampleName) {
	return player(page, name).getByRole("slider", { name: "Seek", exact: true });
}

export async function playFromFiles(page: Page, password: string) {
	await signIn(page, "/directories/root", password);
	await page.getByRole("link", { name: sampleName, exact: true }).click();
	await startPlayback(page);
}

export async function waitForPlayer(page: Page, name = sampleName) {
	await expect(position(page, name)).toHaveAttribute("max", /^[1-9]\d*$/);
	await expect(player(page, name)).not.toHaveAttribute("aria-busy", "true");
}

export async function startPlayback(page: Page) {
	await waitForPlayer(page);
	await player(page).press("Space");
	await expect
		.poll(async () => Number(await position(page).inputValue()))
		.toBeGreaterThan(2_000);
}

export async function seek(page: Page, fraction: number, name = sampleName) {
	const timeline = position(page, name);
	await player(page, name).hover();
	await timeline.scrollIntoViewIfNeeded();
	const bounds = await timeline.boundingBox();
	if (!bounds) throw new Error("Playback timeline is not visible.");
	await page.mouse.click(
		bounds.x + bounds.width * fraction,
		bounds.y + bounds.height / 2,
	);
}

export async function selectSubtitle(page: Page, title: RegExp) {
	const video = player(page);
	await video.hover();
	await video.getByRole("button", { name: "Settings", exact: true }).click();
	await video.getByRole("button", { name: /^Subtitles / }).click();
	const track = video.getByRole("button", { name: title });
	await track.click();
	await expect(track).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("Escape");
}

export function styledSubtitleFrame(page: Page) {
	const canvas = player(page).locator(
		".lmp-styled-subtitles[data-visible=true] canvas",
	);
	// Compare only the subtitle layer, obscuring the video and controls behind it.
	return canvas.screenshot({
		style: `
			.libmedia-player { background: black !important }
			.libmedia-player *:not(:has(.lmp-styled-subtitles)):not(.lmp-styled-subtitles, .lmp-styled-subtitles canvas) {
				opacity: 0 !important;
			}
		`,
	});
}
