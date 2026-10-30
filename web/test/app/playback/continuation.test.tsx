// @vitest-environment happy-dom

import { expect, test } from "vitest";
import { animeFixture } from "../../fixtures/anime.js";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { mockAnime } from "../support/anime.js";
import { setupAppTest } from "../support/lifecycle.js";
import { playbackTitleFixture } from "../support/playback.js";
import { renderApp } from "../support/render-app.js";
import { fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

test("the continuation shortcut lives in Playback options and shares the Settings preference", async () => {
	localStorage.removeItem("anishelf.autoContinue");
	try {
		renderApp("/files/file-1");
		const video = await screen.findByLabelText("Video: Episode 01.mp4");
		expect(
			screen.queryByRole("checkbox", { name: "Continue automatically" }),
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "More playback options" }),
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Playback options" }),
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Playback options",
		});
		expect(
			within(dialog).queryByText(
				/cancellable ten-second countdown|applies to all anime in this browser/,
			),
		).toBeNull();
		fireEvent.click(
			within(dialog).getByRole("checkbox", { name: "Continue automatically" }),
		);
		expect(localStorage.getItem("anishelf.autoContinue")).toBe("true");
		expect(screen.getByLabelText("Video: Episode 01.mp4")).toBe(video);
		fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(
			screen.queryByRole("checkbox", { name: "Continue automatically" }),
		).toBeNull();
		fireEvent.click(screen.getByRole("link", { name: "Settings" }));
		const sections = await screen.findByRole("navigation", {
			name: "Settings sections",
		});
		fireEvent.click(within(sections).getByRole("link", { name: "Playback" }));
		const setting = await screen.findByRole("switch", {
			name: "Continue automatically",
		});
		expect(setting.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(setting);
		expect(localStorage.getItem("anishelf.autoContinue")).toBe("false");
	} finally {
		localStorage.removeItem("anishelf.autoContinue");
	}
});

test("actual playback end offers a cancellable continuation while preserving the completed source save", async () => {
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
	localStorage.setItem("anishelf.autoContinue", "true");
	try {
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
		await screen.findByText("Continuing in 10 seconds…");
		await waitFor(() =>
			expect(
				fetcher.mock.calls.some(
					([path, init]) =>
						String(path).endsWith("/progress") &&
						JSON.parse(String(init?.body)).positionMs === 100000,
				),
			).toBe(true),
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByText(/Continuing in/)).toBeNull();
		expect(screen.getByLabelText("Video: Local Frieren — Episode 1")).toBe(
			video,
		);
	} finally {
		localStorage.removeItem("anishelf.autoContinue");
	}
});
