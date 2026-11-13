// @vitest-environment happy-dom

import { expect, test } from "vitest";
import { animeFixture } from "../../fixtures/anime.js";
import {
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { mockAnime } from "../support/anime.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";

import { connectAnimeViewing } from "./support/app-catalog-fixture.js";

setupAppTest();

test("detail keeps next playback visible but disabled without tracking progress", async () => {
	mockAnime(animeFixture());
	renderApp("/anime/work-1");
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	const action = screen.getByRole("button", { name: "Play next episode" });
	expect(action.hasAttribute("disabled")).toBe(true);
});

test("detail next playback opens the version chooser for the next unwatched episode", async () => {
	mockAnime(animeFixture());
	connectAnimeViewing(0);
	renderApp("/anime/work-1");
	const action = await screen.findByRole("button", { name: "Play episode 1" });
	fireEvent.click(action);
	const dialog = await screen.findByRole("dialog", {
		name: /Choose a file version/,
	});
	expect(within(dialog).getAllByText(/1080p · Group A/)).toHaveLength(3);
});

test("detail next playback navigates directly when the target has one version", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw new Error("Missing fixture episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	connectAnimeViewing(0);
	renderApp("/anime/work-1");
	fireEvent.click(
		await screen.findByRole("button", { name: "Play episode 1" }),
	);
	await screen.findByLabelText("Video: Episode 01.mp4");
});

test("the card play link opens the next episode chooser through the detail route", async () => {
	mockAnime(animeFixture());
	connectAnimeViewing(0);
	renderApp("/anime/work-1?play=next");
	const dialog = await screen.findByRole("dialog", {
		name: /Choose a file version/,
	});
	expect(within(dialog).getAllByText(/1080p · Group A/)).toHaveLength(3);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).not.toContain("play="),
	);
});
