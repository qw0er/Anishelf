// @vitest-environment happy-dom

import { expect, test } from "vitest";
import { animeFixture } from "../../fixtures/anime.js";
import {
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { trackingProvider } from "../../support/tracking-fixture.js";
import { mockAnime } from "../support/anime.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

test("library cards expose the server next playback target", async () => {
	const detail = animeFixture();
	mockAnime(detail);
	const fallback = requiredFetch(fetcher.getMockImplementation());
	fetcher.mockImplementation(async (input, init) => {
		if (String(input).startsWith("/api/anime/library?"))
			return json({
				items: [
					{
						...detail.work,
						localWorkId: detail.work.id,
						viewing: { status: "watching", progress: 0, updatedAt: 1 },
						availableUnwatchedEpisodes: 2,
						nextPlayback: {
							episodeId: "ep-1",
							episodeNumber: "1",
							versionCount: 1,
							fileId: "file-1",
							sourceVersion: "source-v1",
						},
					},
				],
				page: 1,
				perPage: 24,
				hasNextPage: false,
				localState: "available",
				tracking: {
					provider: trackingProvider,
					accountId: null,
					generation: "fixture",
					state: "disconnected",
					fetchedAt: null,
					stale: true,
					refreshing: false,
					error: null,
				},
			});
		return fallback(input, init);
	});
	renderApp("/");
	const play = await screen.findByRole("link", {
		name: "Play episode 1: Frieren",
	});
	const href = play.getAttribute("href") ?? "";
	expect(href).toContain("/files/file-1");
	expect(href).toContain("anime=work-1");
	expect(href).toContain("episode=ep-1");
	expect(href).toContain("version=source-v1");
	expect(href).toContain("library=%2F");
});

test("poster library filters local titles, preserves return context and selects an actual source version", async () => {
	const detail = animeFixture();
	detail.metadata.data.titles.push({
		value: "Short alias",
		language: "en",
		kind: "alias",
	});
	mockAnime(detail);
	renderApp("/?query=Frieren&sort=recent");
	const card = await screen.findByRole("link", { name: "Frieren" });
	fireEvent.click(card);
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	expect(screen.queryByRole("button", { name: "Show all titles" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Collapse titles" })).toBeNull();
	expect(screen.getByText("Aired episodes")).toBeTruthy();
	expect(screen.getByText("3 / 3")).toBeTruthy();
	const episode = screen.getByText("Episode 1").closest("li");
	expect(episode).toBeTruthy();
	fireEvent.click(
		within(episode as HTMLElement).getByRole("button", {
			name: "Play: Episode 1",
		}),
	);
	const dialog = await screen.findByRole("dialog");
	expect(within(dialog).getAllByText(/1080p · Group A/)).toHaveLength(3);
	expect(within(dialog).getAllByRole("link", { name: "Play" })).toHaveLength(2);
	expect(within(dialog).getAllByText(/opens its normal timeline/)).toHaveLength(
		3,
	);
	fireEvent.click(
		within(dialog).getAllByRole("link", { name: "Play" })[0] as HTMLElement,
	);
	await screen.findByLabelText("Video: Episode 01.mp4");
	expect(
		fetcher.mock.calls.some(([path]) =>
			String(path).startsWith("/api/files/file-1/subtitles"),
		),
	).toBe(true);
	const back = screen.getByRole("link", { name: "Back to anime" });
	expect(back.getAttribute("href")).toContain("#episode-ep-1");
	expect(screen.getByTestId("location").textContent).toContain(
		"version=source-v1",
	);
	fireEvent.click(back);
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	fireEvent.click(screen.getByRole("link", { name: "Back to library" }));
	await screen.findByRole("heading", { name: "Anime library" });
	expect(screen.getByTestId("location").textContent).toBe(
		"/?query=Frieren&sort=recent",
	);
	expect(
		(screen.getByLabelText("Search titles") as HTMLInputElement).value,
	).toBe("Frieren");
	expect(document.activeElement?.id).toBe("work-work-1");
});

test("search and immediate filters reset pagination and preserve applied criteria", async () => {
	const detail = animeFixture();
	mockAnime(detail);
	renderApp("/?page=2");
	await screen.findByRole("link", { name: "Frieren" });
	fireEvent.change(screen.getByLabelText("Search titles"), {
		target: { value: "葬送" },
	});
	fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
	fireEvent.click(screen.getByRole("button", { name: "Filters" }));
	fireEvent.change(screen.getByRole("combobox", { name: "Format" }), {
		target: { value: "TV" },
	});
	fireEvent.change(screen.getByLabelText("Release year"), {
		target: { value: "2023" },
	});
	fireEvent.blur(screen.getByLabelText("Release year"));
	fireEvent.change(screen.getByRole("combobox", { name: "Availability" }), {
		target: { value: "available" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
	fireEvent.click(
		await screen.findByRole("menuitemradio", { name: "Recently added" }),
	);
	await waitFor(() => expect(screen.getByText("Page 1")).toBeTruthy());
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([path]) => {
				const url = new URL(String(path), "http://localhost");
				return (
					url.pathname === "/api/anime/library" &&
					url.searchParams.get("query") === "葬送" &&
					url.searchParams.get("format") === "TV" &&
					url.searchParams.get("year") === "2023" &&
					url.searchParams.get("availability") === "available" &&
					url.searchParams.get("sort") === "recent" &&
					!url.searchParams.has("page")
				);
			}),
		).toBe(true),
	);
	expect(
		fetcher.mock.calls.some(([path]) =>
			String(path).startsWith("/api/metadata/search"),
		),
	).toBe(false);
});

test("the default Watching poster wall exposes a filtered empty state and access to Files", async () => {
	renderApp("/");
	await screen.findByText(/No anime match these filters/);
	expect(
		screen
			.getAllByRole("link", { name: "Files" })
			.every((link) => link.getAttribute("href") === "/directories/root"),
	).toBe(true);
});

test("failed poster artwork falls back to the real title without losing the work link", async () => {
	mockAnime(animeFixture());
	renderApp("/");
	await screen.findByRole("link", { name: "Frieren" });
	fireEvent.error(screen.getByRole("img", { name: "Frieren" }));
	expect(screen.queryByRole("img", { name: "Frieren" })).toBeNull();
	expect(screen.getByRole("link", { name: "Frieren" })).toBeTruthy();
});

test("poster sorting defaults to unwatched first and exposes all four choices", async () => {
	mockAnime(animeFixture());
	renderApp("/");
	await screen.findByRole("link", { name: "Frieren" });
	const choices = {
		updated: "Recently updated",
		title: "Title",
		recent: "Recently added",
		unwatched: "Unwatched first",
	};
	for (const sort of ["updated", "title", "recent", "unwatched"] as const) {
		fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
		await screen.findByRole("menuitemradio", { name: "Unwatched first" });
		expect(
			screen.getAllByRole("menuitemradio").map((item) => item.textContent),
		).toEqual([
			"Unwatched first",
			"Recently updated",
			"Title",
			"Recently added",
		]);
		fireEvent.click(screen.getByRole("menuitemradio", { name: choices[sort] }));
		await waitFor(() => {
			const location = screen.getByTestId("location").textContent ?? "";
			expect(
				new URL(location, "http://localhost").searchParams.get("sort"),
			).toBe(sort === "unwatched" ? null : sort);
		});
	}
});
