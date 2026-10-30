// @vitest-environment happy-dom

import { expect, test } from "vitest";
import { animeFixture } from "../../fixtures/anime.js";
import { fireEvent, screen, within } from "../../support/query-test-utils.js";
import { trackingProvider } from "../../support/tracking-fixture.js";
import { mockAnime } from "../support/anime.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { appFixture, fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

test.each([0, 2])(
	"local detail keeps progress in its header and only shows positive unwatched hints (progress %s)",
	async (progress) => {
		mockAnime(animeFixture());
		const fallback = fetcher.getMockImplementation();
		fetcher.mockImplementation(async (input, init) => {
			const path = String(input);
			if (path === "/api/tracking/account")
				return json({
					provider: trackingProvider,
					generation: "header-viewing",
					account: { id: "anilist:7", name: "Fixture" },
					state: "connected",
					connectivity: "available",
					checkedAt: 0,
				});
			if (path.startsWith("/api/tracking/entries/anilist%3Aanime%3A154587?"))
				return json({
					provider: trackingProvider,
					accountId: "anilist:7",
					generation: "header-viewing",
					state: "connected",
					fetchedAt: 1000,
					stale: false,
					refreshing: false,
					error: null,
					entry: {
						id: 1,
						mediaId: 154587,
						progress,
						status: "watching",
						updatedAt: 1,
						titles: ["Frieren"],
						format: "TV",
						year: 2023,
						episodeCount: 3,
						coverUrl: null,
					},
				});
			return requiredFetch(fallback)(input, init);
		});
		renderApp("/anime/work-1");
		const title = await screen.findByRole("heading", {
			name: "Frieren",
			level: 1,
		});
		const header = title.parentElement;
		if (!header) throw new Error("Missing title header");
		const summary = await within(header).findByRole("region", {
			name: "the tracking service viewing state",
		});
		await within(summary).findByText(`${progress} / 3 episodes`);
		expect(screen.queryByText(/AniList progress: 2 watched/)).toBeNull();
		expect(screen.queryByText(/0 unwatched available/)).toBeNull();
		if (progress === 2) {
			expect(screen.getAllByText("Watched")).toHaveLength(2);
			expect(screen.getByText("Unwatched")).toBeTruthy();
			expect(
				screen.queryByRole("button", {
					name: "About available unwatched episodes",
				}),
			).toBeNull();
		} else {
			expect(screen.queryByText("Watched")).toBeNull();
			expect(screen.getAllByText("Unwatched")).toHaveLength(3);
			const hint = screen.getByRole("button", {
				name: "About available unwatched episodes",
			});
			expect(hint.textContent).toContain("1 unwatched available");
			fireEvent.click(hint);
			await screen.findByText(
				"Locally available episodes numbered after your cumulative the tracking service progress. Local playback history is separate.",
			);
		}
		expect(within(summary).getByText("Watching")).toBeTruthy();
		expect(within(summary).queryByRole("heading")).toBeNull();
		expect(
			within(summary).queryByText(/separate from local playback history/),
		).toBeNull();
		expect(
			screen.getAllByRole("region", {
				name: "the tracking service viewing state",
			}),
		).toHaveLength(1);
	},
);

test.each(["source-v1", "older-source"])(
	"anime details read prepared summaries before opening menus and isolate %s",
	async (sourceVersion) => {
		const detail = animeFixture();
		const episode = detail.episodes[0];
		if (!episode) throw Error("Missing episode");
		episode.versions = episode.versions.slice(0, 1);
		appFixture.compatibilityStatus = "unsupported";
		mockAnime(detail);
		const fallback = requiredFetch(fetcher.getMockImplementation());
		fetcher.mockImplementation(async (input, init) =>
			String(input) === "/api/preparations/summaries"
				? json({
						files: [
							{
								fileId: "file-1",
								versions: [
									{ sourceVersion, publishedCopies: 1, pendingTasks: 0 },
								],
							},
						],
					})
				: fallback(input, init),
		);
		renderApp("/anime/work-1");
		const label =
			sourceVersion === "source-v1"
				? "Pre-transcoded copy published."
				: "This file is not supported by this browser.";
		const status = await screen.findByRole("button", { name: label });
		const menu = screen.getByRole("button", { name: "File actions" });
		const play = screen.getByRole("link", { name: "Play: Episode 1" });
		expect(
			status.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			menu.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			fetcher.mock.calls.filter(
				([url]) => url === "/api/preparations/summaries",
			),
		).toHaveLength(1);
		expect(
			fetcher.mock.calls.some(
				([url]) =>
					String(url).startsWith("/api/preparations?") &&
					String(url).includes("fileId="),
			),
		).toBe(false);
		if (sourceVersion === "source-v1")
			expect(
				screen.queryByRole("button", {
					name: "This file is not supported by this browser.",
				}),
			).toBeNull();
	},
);
