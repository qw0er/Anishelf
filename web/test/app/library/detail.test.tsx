// @vitest-environment happy-dom

import { expect, test, vi } from "vitest";
import { queryClient } from "../../../src/shared/api/query-client.js";
import {
	animeDetailFixture,
	animeFixture,
	reviewFixture,
} from "../../fixtures/anime.js";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { mockAnime } from "../support/anime.js";
import { setupAppTest } from "../support/lifecycle.js";
import { renderApp } from "../support/render-app.js";
import { appFixture, fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

test("detail renders unknown/missing/unavailable separately and sanitizes provider descriptions", async () => {
	const detail = animeFixture();
	const titleHeight = vi
		.spyOn(HTMLElement.prototype, "scrollHeight", "get")
		.mockImplementation(function (this: HTMLElement) {
			return this.textContent ===
				"An alternative title long enough to wrap on narrow screens"
				? 80
				: 0;
		});
	detail.metadata.data.titles.push({
		value: "An alternative title long enough to wrap on narrow screens",
		language: "en",
		kind: "alias",
	});
	mockAnime(detail);
	renderApp("/anime/work-1");
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	const expandTitles = screen.getByRole("button", { name: "Show all titles" });
	expect(expandTitles.getAttribute("aria-expanded")).toBe("false");
	fireEvent.click(expandTitles);
	expect(
		screen
			.getByRole("button", { name: "Collapse titles" })
			.getAttribute("aria-expanded"),
	).toBe("true");
	fireEvent.click(screen.getByRole("button", { name: "Collapse titles" }));
	titleHeight.mockRestore();

	expect(screen.getByText("Safe synopsis").tagName).toBe("B");
	expect(document.querySelector("main script")).toBeNull();
	expect(
		document.querySelector('main img[src*="tracking.invalid"]'),
	).toBeNull();
	expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
	expect(screen.getByText("Unknown")).toBeTruthy();
	expect(
		screen
			.getByRole("button", { name: "Play: Episode 2" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(
		screen
			.getByRole("button", { name: "Play: Episode 3" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(screen.getByText(/No associated local file/)).toBeTruthy();
	expect(screen.queryByText("Hidden spoiler")).toBeNull();
	fireEvent.click(screen.getByText("More metadata"));
	fireEvent.click(screen.getByRole("button", { name: "Show spoiler tags" }));
	expect(screen.getByText("Hidden spoiler")).toBeTruthy();
});

test("a single usable version links directly to playback and provider refresh failure keeps it usable", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw new Error("Missing fixture episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/catalog/works/work-1/refresh") {
			detail.metadata.refreshError = {
				code: "unavailable",
				message: "Unavailable",
				retryAt: null,
			};
			return json(detail);
		}
		return requiredFetch(fallback)(input, init);
	});
	renderApp("/anime/work-1?library=https%3A%2F%2Fevil.invalid");
	const play = await screen.findByRole("link", { name: "Play: Episode 1" });
	fireEvent.click(
		within(play.closest("li") as HTMLElement).getByRole("button", {
			name: "File actions",
		}),
	);
	expect(
		(
			await screen.findByRole("menuitem", { name: "Correct associations" })
		).getAttribute("href"),
	).toBe(`/review?item=${episode.versions[0]?.reviewId}&decision=confirmed`);
	fireEvent.keyDown(
		screen.getByRole("menuitem", { name: "Correct associations" }),
		{ key: "Escape" },
	);

	expect(play.getAttribute("href")).toContain("library=%2F");
	expect(
		screen.getByRole("link", { name: "Back to library" }).getAttribute("href"),
	).toBe("/");
	fireEvent.click(screen.getByRole("button", { name: "Refresh metadata" }));
	await screen.findByText(/Metadata could not be refreshed/, {
		selector: "[data-slot=toast-title]",
	});
	expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
	expect(screen.getByRole("link", { name: "Play: Episode 1" })).toBeTruthy();
});

test("unavailable anime playback retains its detail return link for choosing another version", async () => {
	mockAnime(animeFixture());
	appFixture.fileError = true;
	renderApp(
		"/files/file-1?anime=work-1&episode=ep-1&library=%2F%3Fquery%3DFrieren&version=source-v1",
	);
	await screen.findByRole("alert");
	const back = screen.getByRole("link", { name: "Back to anime" });
	expect(back.getAttribute("href")).toBe(
		"/anime/work-1?library=%2F%3Fquery%3DFrieren#episode-ep-1",
	);
	fireEvent.click(back);
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
});

test("anime version links pin the selected source version and refuse a replaced source", async () => {
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/playback/options") {
			const intent = JSON.parse(String(init?.body));
			expect(intent.sourceVersion).toBe("replaced-version");
			return json(
				{
					error: {
						code: "PLAYBACK_CONFLICT",
						message: "Source changed",
						requestId: "version-conflict",
					},
				},
				409,
			);
		}
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp("/files/file-1?anime=work-1&episode=ep-1&version=replaced-version");
	await screen.findByRole("heading", { name: "Unable to play this video" });
	expect(screen.queryByLabelText("Video: Episode 01.mp4")).toBeNull();
	expect(screen.getByRole("link", { name: "Back to anime" })).toBeTruthy();
});

test("details distinguish scheduled count-derived slots from manual mappings and list unresolved candidates", async () => {
	const detail = animeFixture();
	const item = reviewFixture();
	mockAnime(detail);
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.includes("/airing?"))
			return json({
				snapshotId: "airing",
				fetchedAt: Date.now(),
				stale: false,
				refreshing: false,
				refreshError: null,
				data: {
					items: [2, 3].map((episode) => ({
						id: String(episode),
						episode,
						airingAt: Math.floor(Date.now() / 1000) + 86400,
					})),
					page: 1,
					perPage: 25,
					hasNextPage: false,
				},
			});
		if (path.startsWith("/api/catalog/reviews?")) {
			expect(new URL(path, "http://localhost").searchParams.get("workId")).toBe(
				detail.work.id,
			);
			return json({ items: [item], page: 1, perPage: 20, hasNextPage: false });
		}
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp("/anime/work-1");
	fireEvent.click(
		await screen.findByRole("button", { name: "Files to review" }),
	);
	await screen.findByRole("link", { name: item.relativePath });
	await waitFor(() =>
		expect(document.getElementById("episode-ep-3")?.textContent).toContain(
			"Not yet aired",
		),
	);
	expect(document.getElementById("episode-ep-2")?.textContent).toContain(
		"Local files unavailable",
	);
	expect(
		screen.getByRole("link", { name: item.relativePath }).getAttribute("href"),
	).toBe(`/review?item=${item.id}`);
	expect(
		screen
			.getByRole("button", { name: "Play: Episode 3" })
			.hasAttribute("disabled"),
	).toBe(true);
});

test("airing pagination retains browsing and unknown schedule evidence never marks a slot unaired", async () => {
	mockAnime(animeFixture());
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.includes("/airing?")) {
			const page = Number(
				new URL(path, "http://localhost").searchParams.get("page"),
			);
			return json({
				snapshotId: "airing",
				fetchedAt: Date.now(),
				stale: false,
				refreshing: false,
				refreshError: null,
				data: {
					items:
						page === 1
							? []
							: [
									{
										id: "ep3",
										episode: 3,
										airingAt: Math.floor(Date.now() / 1000) + 86400,
									},
								],
					page,
					perPage: 25,
					hasNextPage: page === 1,
				},
			});
		}
		if (!fallback) throw new Error("Missing fixture");
		return fallback(input, init);
	});
	renderApp("/anime/work-1");
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	expect(screen.getByText("Provider airing schedule")).toBeTruthy();
	expect(document.getElementById("episode-ep-3")?.textContent).toContain(
		"Airing information is unknown",
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Load more airing records" }),
	);
	await waitFor(() =>
		expect(document.getElementById("episode-ep-3")?.textContent).toContain(
			"Not yet aired",
		),
	);
	const table = await screen.findByRole("table", {
		name: "Provider airing schedule",
	});
	expect(within(table).getByText("Episode 3")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Play: Episode 1" })).toBeTruthy();
});

test("detail loads content and lightweight status once without fetching closed activity", async () => {
	mockAnime(animeFixture());
	renderApp("/anime/work-1");
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter(([input]) =>
				String(input).startsWith("/api/anime/status/"),
			),
		).toHaveLength(1),
	);
	const paths = fetcher.mock.calls.map(([input]) => String(input));
	expect(
		paths.filter((path) => path === "/api/anime/details/local/work-1"),
	).toHaveLength(1);
	expect(
		paths.filter(
			(path) =>
				path.startsWith("/api/tracking/entries/") ||
				path.startsWith("/api/acquisition/subscriptions?") ||
				path.startsWith("/api/acquisition/downloads?") ||
				path === "/api/catalog/works/work-1",
		),
	).toEqual([]);
});

test("a tracked detail refetch switches to local episodes while preserving library context", async () => {
	const local = animeFixture();
	mockAnime(local);
	const fallback = requiredFetch(fetcher.getMockImplementation());
	let available = false;
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/anime/details/works/anilist%3Aanime%3A154587") {
			const detail = animeDetailFixture(local);
			return json({ ...detail, local: available ? local : null });
		}
		return fallback(input, init);
	});
	const library = "/?scope=all&viewingStatus=watching&query=Frieren";
	renderApp(
		`/anime/tracked/anilist%3Aanime%3A154587?${new URLSearchParams({ library })}`,
	);
	await screen.findByText("No local resources are associated with this work.");
	expect(screen.queryByText("Episode 1")).toBeNull();
	// Provider posters are proxied through the backend artwork cache.
	expect(screen.getByRole("img", { name: "Frieren" }).getAttribute("src")).toBe(
		"/api/metadata/metadata-work-1/artwork/cover/image",
	);
	available = true;
	await act(async () => {
		await queryClient.refetchQueries({
			queryKey: ["anime-detail"],
			type: "active",
		});
	});
	await screen.findByText("Episode 1");
	expect(
		screen.queryByText("No local resources are associated with this work."),
	).toBeNull();
	expect(screen.getByTestId("location").textContent).toContain(
		"/anime/work-1?",
	);
	expect(
		screen.getByRole("link", { name: "Back to library" }).getAttribute("href"),
	).toBe(library);
});
