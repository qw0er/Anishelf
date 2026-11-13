// @vitest-environment happy-dom

import { expect, test } from "vitest";
import { animeFixture } from "../../fixtures/anime.js";
import {
	act,
	fireEvent,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";
import { mockAnime } from "../support/anime.js";
import { setupAppTest } from "../support/lifecycle.js";
import { playbackTitleFixture } from "../support/playback.js";
import { renderApp } from "../support/render-app.js";
import { fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

test("playback end keeps the next episode manual and saves progress", async () => {
	const detail = animeFixture();
	const template = detail.episodes[0]?.versions[0];
	const next = detail.episodes[1];
	if (!template || !next) throw Error("Missing episode fixture");
	next.versions = [{ ...template, fileId: "file-2", sourceVersion: "v2" }];
	mockAnime(detail);
	const fallback = requiredFetch(fetcher.getMockImplementation());
	fetcher.mockImplementation(async (input, init) =>
		String(input) === "/api/catalog/sources/file-1"
			? json({
					...playbackTitleFixture(),
					associations: playbackTitleFixture().associations.slice(0, 1),
				})
			: fallback(input, init),
	);
	renderApp("/files/file-1");
	const video = await screen.findByLabelText<HTMLVideoElement>(
		"Video: Local Frieren — Episode 1",
	);
	await screen.findByRole("button", { name: "Next: Episode 2" });
	Object.defineProperty(video, "duration", { value: 100 });
	fireEvent.loadedMetadata(video);
	await act(async () => {});
	expect(screen.queryByText(/Continuing in/)).toBeNull();
	Object.defineProperty(video, "paused", {
		value: false,
		configurable: true,
	});
	fireEvent.loadStart(video);
	fireEvent.loadedMetadata(video);
	fireEvent.canPlay(video);
	fireEvent.play(video);
	fireEvent.playing(video);
	video.currentTime = 100;
	fireEvent.ended(video);
	expect(screen.queryByText(/Continuing in/)).toBeNull();
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([path, init]) =>
					String(path).endsWith("/progress") &&
					JSON.parse(String(init?.body)).positionMs === 100000,
			),
		).toBe(true),
	);
	expect(screen.getByRole("button", { name: "Next: Episode 2" })).toBeTruthy();
});
