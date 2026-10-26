// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { AnimeLibraryResponse } from "../src/shared/api/contracts.js";
import { queryClient } from "../src/shared/api/query-client.js";
import {
	animeDetailFixture,
	animeFixture,
	reviewFixture,
} from "./fixtures/anime.js";
import { act, fireEvent, screen, waitFor, within } from "./query-test-utils.js";
import {
	appFixture,
	fetcher,
	file,
	json,
	mockAnime,
	renderApp,
	requiredFetch,
} from "./support/app-fixture.js";
import { trackingProvider } from "./tracking-fixture.js";

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

test("automatic metadata updates appear in an open detail and invalidate the cached poster list", async () => {
	const detail = animeFixture();
	detail.metadata.refreshing = true;
	mockAnime(detail);
	renderApp("/");
	fireEvent.click(await screen.findByRole("link", { name: "Frieren" }));
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
	expect(screen.getByText(/Metadata last updated:/)).toBeTruthy();
	expect(screen.getByText("Refreshing metadata…")).toBeTruthy();
	detail.work = {
		...detail.work,
		providerTitle: "Updated Frieren",
		displayTitle: "Updated Frieren",
	};
	detail.metadata = {
		...detail.metadata,
		snapshotId: "new-snapshot",
		fetchedAt: Date.now(),
		stale: false,
		refreshing: false,
	};
	await screen.findByRole(
		"heading",
		{ name: "Updated Frieren", level: 1 },
		{ timeout: 4000 },
	);
	expect(screen.queryByText("Refreshing metadata…")).toBeNull();
	expect(
		fetcher.mock.calls.some(([path]) =>
			String(path).endsWith("/work-1/refresh"),
		),
	).toBe(false);
	fireEvent.click(screen.getByRole("link", { name: "Back to library" }));
	await screen.findByRole("link", { name: "Updated Frieren" });
	expect(
		fetcher.mock.calls.filter(([path]) =>
			String(path).startsWith("/api/anime/library?"),
		).length,
	).toBeGreaterThan(1);
});

test("AniList library shows status and remote-only details, keeps filters and refreshes", async () => {
	const detail = animeFixture();
	mockAnime(detail);
	const fallback = fetcher.getMockImplementation();
	const tracking: AnimeLibraryResponse["tracking"] = {
		provider: trackingProvider,
		accountId: "anilist:7",
		generation: "list-fixture",
		state: "connected",
		fetchedAt: 1000,
		stale: true,
		refreshing: false,
		error: { code: "unavailable", retryAt: 2000 },
	};
	const remote = {
		...detail.work,
		id: "anilist-2",
		localWorkId: null,
		displayTitle: "Remote work",
		reference: { provider: "anilist", mediaType: "anime", id: "2" },
		availableEpisodes: 0,
		availableRegularEpisodes: 0,
		viewing: { status: "planned", progress: 0, updatedAt: 1 },
	};
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path === "/api/tracking/account")
			return json({
				provider: trackingProvider,
				generation: tracking.generation,
				account: { id: "anilist:7", name: "Fixture" },
				state: "connected",
				connectivity: "available",
				checkedAt: 0,
			});
		if (path.startsWith("/api/anime/library?")) {
			const params = new URL(path, "http://localhost").searchParams;
			return json({
				items:
					params.get("scope") === "all"
						? [remote]
						: [
								{
									...detail.work,
									localWorkId: detail.work.id,
									viewing: { status: "watching", progress: 3, updatedAt: 1 },
								},
							],
				page: 1,
				perPage: 24,
				hasNextPage: false,
				localState: "available",
				tracking,
			});
		}
		if (path === "/api/tracking/refresh") {
			tracking.fetchedAt = Date.now();
			tracking.stale = false;
			tracking.error = null;
			return json({ ...tracking, entries: [] });
		}
		if (path.startsWith("/api/tracking/entries/anilist%3Aanime%3A2?"))
			return json({
				...tracking,
				entry: {
					id: 1,
					mediaId: 2,
					progress: 0,
					status: "planned",
					updatedAt: 1,
					titles: ["Remote work"],
					format: "TV",
					year: 2025,
					episodeCount: 12,
					coverUrl: null,
				},
			});
		if (path.startsWith("/api/metadata/missing-2"))
			return json(
				{ message: "Unavailable", code: "METADATA_UNAVAILABLE" },
				503,
			);
		if (!fallback) throw new Error("Missing fetch fixture");
		return fallback(input, init);
	});
	renderApp("/");
	const localCard = await screen.findByRole("link", { name: "Frieren" });
	expect(within(localCard).getByText("Watching")).toBeTruthy();
	expect(within(localCard).getByText("3 / 3")).toBeTruthy();
	const toolbar = within(
		screen.getByRole("group", { name: "Library controls" }),
	);
	expect(toolbar.getByRole("button", { name: "Search" })).toBeTruthy();
	expect(toolbar.getByRole("button", { name: "Filters" })).toBeTruthy();
	expect(toolbar.getByRole("button", { name: "Sort by" })).toBeTruthy();
	const refreshButton = toolbar.getByRole("button", {
		name: "Refresh the tracking service list",
	});
	expect(refreshButton.textContent).toBe("");
	expect(refreshButton.hasAttribute("data-base-ui-tooltip-trigger")).toBe(true);
	expect(
		screen.queryByText("Showing cached the tracking service viewing state."),
	).toBeNull();
	expect(screen.queryByRole("combobox", { name: "Library scope" })).toBeNull();
	expect(
		screen.queryByRole("combobox", {
			name: "the tracking service viewing state",
		}),
	).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Filters" }));
	fireEvent.change(screen.getByRole("combobox", { name: "Library scope" }), {
		target: { value: "all" },
	});
	const remoteLink = await screen.findByRole("link", { name: "Remote work" });
	expect(remoteLink.getAttribute("href")).toContain(
		"/anime/tracked/anilist%3Aanime%3A2?",
	);
	fireEvent.change(
		screen.getByRole("combobox", {
			name: "the tracking service viewing state",
		}),
		{
			target: { value: "planned" },
		},
	);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toContain(
			"viewingStatus=planned",
		),
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Refresh the tracking service list" }),
	);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([url, init]) =>
					url === "/api/tracking/refresh" && init?.method === "POST",
			),
		).toBe(true),
	);
	await waitFor(() =>
		expect(
			screen.queryByText("Showing cached the tracking service viewing state."),
		).toBeNull(),
	);
	await screen.findByText("the tracking service list refreshed.", {
		selector: "[data-slot=toast-title]",
	});
	fireEvent.click(await screen.findByRole("link", { name: "Remote work" }));
	await screen.findByRole("heading", { name: "Remote work", level: 1 });
	const remoteState = within(
		screen.getByRole("region", { name: "the tracking service viewing state" }),
	);
	expect(remoteState.getByText("Planning")).toBeTruthy();
	expect(remoteState.getByText("0 / 12 episodes")).toBeTruthy();
	expect(remoteState.queryByRole("heading")).toBeNull();
	expect(
		screen.getByText("No local resources are associated with this work."),
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: /Play:/ })).toBeNull();
	fireEvent.click(screen.getByRole("link", { name: "Back to library" }));
	await screen.findByRole("heading", { name: "Anime library" });
	expect(screen.getByTestId("location").textContent).toContain(
		"scope=all&viewingStatus=planned",
	);
	expect(
		fetcher.mock.calls.some(([url]) =>
			String(url).includes("/api/catalog/confirmations"),
		),
	).toBe(false);
});

test("account lookup failure keeps Library filters and retries without falling back to Catalog", async () => {
	mockAnime(animeFixture());
	const fallback = fetcher.getMockImplementation();
	let failed = true;
	fetcher.mockImplementation(async (input, init) => {
		if (String(input) === "/api/tracking/account" && failed)
			return json(
				{ error: { code: "TRACKING_UNAVAILABLE", message: "Unavailable" } },
				503,
			);
		return requiredFetch(fallback)(input, init);
	});
	renderApp("/?scope=all&viewingStatus=planned&query=Frieren&page=2");
	const retry = await screen.findByRole("button", { name: "Retry" });
	expect(screen.getByTestId("location").textContent).toContain(
		"viewingStatus=planned",
	);
	expect(
		fetcher.mock.calls.some(([path]) =>
			String(path).startsWith("/api/catalog/works?"),
		),
	).toBe(false);
	failed = false;
	fireEvent.click(retry);
	await screen.findByRole("link", { name: "Frieren" });
	expect(
		fetcher.mock.calls.some(([path]) => {
			const url = new URL(String(path), "http://localhost");
			return (
				url.pathname === "/api/anime/library" &&
				url.searchParams.get("scope") === "all" &&
				url.searchParams.get("viewingStatus") === "planned" &&
				url.searchParams.get("query") === "Frieren" &&
				url.searchParams.get("page") === "2" &&
				url.searchParams.get("generation") === "fixture"
			);
		}),
	).toBe(true);
	expect(
		fetcher.mock.calls.some(([path]) =>
			String(path).startsWith("/api/catalog/works?"),
		),
	).toBe(false);
});

test("Library filters allow All works before local setup and disable viewing state without an account", async () => {
	appFixture.settings = { resourceRoots: [] };
	renderApp("/");
	const filters = await screen.findByRole("button", { name: "Filters" });
	expect(screen.queryByRole("combobox", { name: "Library scope" })).toBeNull();
	fireEvent.click(filters);
	const viewing = screen.getByRole("combobox", {
		name: "the tracking service viewing state",
	});
	expect(viewing.hasAttribute("disabled")).toBe(true);
	fireEvent.change(screen.getByRole("combobox", { name: "Library scope" }), {
		target: { value: "all" },
	});
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([path]) => {
				const url = new URL(String(path), "http://localhost");
				return (
					url.pathname === "/api/anime/library" &&
					url.searchParams.get("scope") === "all"
				);
			}),
		).toBe(true),
	);
	await screen.findByText(/No anime match these filters/);
	expect(screen.getByTestId("location").textContent).toContain("scope=all");
});

test("the Library AniList connection button opens Settings", async () => {
	renderApp("/");
	fireEvent.click(
		await screen.findByRole("button", {
			name: "Connect the tracking service in Settings",
		}),
	);
	await screen.findByRole("heading", { name: "Settings", level: 1 });
	expect(screen.getByTestId("location").textContent).toContain("/settings");
});

test.each(["retained response", "network"])(
	"manual AniList refresh failure uses a Toast for %s and keeps cache context",
	async (failureKind) => {
		const fallback = fetcher.getMockImplementation();
		const snapshot: AnimeLibraryResponse["tracking"] = {
			provider: trackingProvider,
			accountId: "anilist:7",
			generation: `manual-${failureKind}`,
			state: "connected",
			fetchedAt: 1000,
			stale: true,
			refreshing: false,
			error: null,
		};
		fetcher.mockImplementation(async (input, init) => {
			const path = String(input);
			if (path === "/api/tracking/account")
				return json({
					provider: trackingProvider,
					generation: snapshot.generation,
					account: { id: "anilist:7", name: "Fixture" },
					state: "connected",
					connectivity: "available",
					checkedAt: 0,
				});
			if (path.startsWith("/api/anime/library?"))
				return json({
					items: [],
					page: 1,
					perPage: 24,
					hasNextPage: false,
					localState: "available",
					tracking: snapshot,
				});
			if (path === "/api/tracking/refresh") {
				if (failureKind === "network")
					throw new TypeError("private transport detail");
				snapshot.error = { code: "unavailable", retryAt: 2000 };
				return json({ ...snapshot, entries: [] });
			}
			return requiredFetch(fallback)(input, init);
		});
		renderApp("/");
		await screen.findByRole("button", {
			name: "Refresh the tracking service list",
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Refresh the tracking service list" }),
		);
		await screen.findByText(
			failureKind === "network"
				? /Cannot connect to the server/
				: /Could not refresh the tracking service/,
			{ selector: "[data-slot=toast-title]" },
		);
		const main = within(screen.getByRole("main"));
		expect(
			main.queryByText(
				/Could not refresh the tracking service|Cannot connect to the server/,
			),
		).toBeNull();
		expect(
			main.queryByText("Showing cached the tracking service viewing state."),
		).toBeNull();
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Refresh the tracking service list" })
					.hasAttribute("disabled"),
			).toBe(false),
		);
	},
);

test("manual metadata refresh success is a Toast and leaves the refresh action available", async () => {
	mockAnime(animeFixture());
	renderApp("/anime/work-1");
	fireEvent.click(
		await screen.findByRole("button", { name: "Refresh metadata" }),
	);
	await screen.findByText("Metadata refreshed.", {
		selector: "[data-slot=toast-title]",
	});
	expect(
		within(screen.getByRole("main")).queryByText("Metadata refreshed."),
	).toBeNull();
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Refresh metadata" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
});

test("single-version anime rows reuse Files commands without leaving detail or opening playback", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw Error("Missing fixture episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp("/anime/work-1?library=%2F%3Fquery%3DFrieren");
	const play = await screen.findByRole("link", { name: "Play: Episode 1" });
	expect(play.getAttribute("href")).toContain("version=source-v1");
	expect(play.getAttribute("href")).toContain("episode=ep-1");
	expect(play.getAttribute("href")).toContain("library=%2F%3Fquery%3DFrieren");
	await screen.findByRole("button", {
		name: "This browser reports support for this file.",
	});
	fireEvent.click(screen.getByRole("button", { name: "File actions" }));
	for (const name of [
		"Copy media link",
		"Download video",
		"Download playlist (.m3u)",
		"Pre-transcode",
	]) {
		expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
	}
	expect(
		screen.getByRole("menuitem", { name: /Open in external player/ }),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("menuitem", { name: "Copy media link" }));
	await screen.findByText(/Link copied/);
	expect(copy).toHaveBeenCalledWith(
		`${window.location.origin}/api/media/file-1?access_token=test-token`,
	);
	expect(screen.getByTestId("location").textContent).toContain("/anime/work-1");
	expect(
		fetcher.mock.calls.some(([url]) => url === "/api/playback/sessions"),
	).toBe(false);
	expect(
		fetcher.mock.calls.some(([url]) =>
			String(url).includes("compatibility?sourceVersion=source-v1"),
		),
	).toBe(true);
});

test("multi-version menus act on the chosen file and omit unavailable file actions", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	const first = episode?.versions[0];
	if (!episode || !first) throw Error("Missing versions");
	episode.versions = [
		first,
		{
			...first,
			sourceId: "source-2",
			fileId: "file-2",
			sourceVersion: "source-v2",
			relativePath: "release-two/episode.mkv",
		},
		{ ...first, sourceId: "source-3", fileId: "file-3", available: false },
	];
	mockAnime(detail);
	const fallback = requiredFetch(fetcher.getMockImplementation());
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/files/file-2/compatibility")) {
			const response = await fallback(path.replace("file-2", "file-1"), init);
			return json({ ...(await response.json()), fileId: "file-2" });
		}
		if (path === "/api/files/file-2")
			return json({
				...file,
				file: { ...file.file, id: "file-2" },
				originalMediaUrl: "/api/media/file-2",
			});
		if (path === "/api/media/file-2/access-link")
			return json({
				url: "/api/media/file-2?access_token=second-token",
				expiresAt: Date.now() + 86400000,
			});
		return fallback(input, init);
	});
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	renderApp("/anime/work-1");
	fireEvent.click(
		await screen.findByRole("button", { name: "Play: Episode 1" }),
	);
	const dialog = await screen.findByRole("dialog", {
		name: /Choose a file version/,
	});
	const chosen = within(dialog)
		.getByText("release-two/episode.mkv")
		.closest("li");
	if (!chosen) throw Error("Missing chosen version row");
	expect(
		within(dialog).getAllByRole("button", { name: "File actions" }),
	).toHaveLength(2);
	expect(
		within(chosen).getByRole("link", { name: "Play" }).getAttribute("href"),
	).toContain("version=source-v2");
	await waitFor(() =>
		expect(
			within(chosen).getByRole("button", {
				name: "This browser reports support for this file.",
			}),
		).toBeTruthy(),
	);
	fireEvent.click(within(chosen).getByRole("button", { name: "File actions" }));
	expect(
		(
			await screen.findByRole("menuitem", { name: "Show in Files" })
		).getAttribute("href"),
	).toBe("/files/file-2/locate");
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Copy media link" }),
	);
	await waitFor(() =>
		expect(copy).toHaveBeenCalledWith(
			`${window.location.origin}/api/media/file-2?access_token=second-token`,
		),
	);
	expect(
		fetcher.mock.calls.some(([url]) =>
			String(url).includes("file-3/compatibility"),
		),
	).toBe(false);
});

test("a changed Catalog source disables its file menu while preserving the version-pinned Web link", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw Error("Missing episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	const fallback = requiredFetch(fetcher.getMockImplementation());
	fetcher.mockImplementation(async (input, init) =>
		String(input).includes("compatibility?sourceVersion=source-v1")
			? json(
					{
						error: {
							code: "PLAYBACK_CONFLICT",
							message: "Source changed",
							requestId: "fixture",
						},
					},
					409,
				)
			: fallback(input, init),
	);
	renderApp("/anime/work-1");
	await screen.findByRole("button", {
		name: "Compatibility could not be checked. You can retry or try the original file.",
	});
	expect(
		screen.getByRole<HTMLButtonElement>("button", { name: "File actions" })
			.disabled,
	).toBe(true);
	expect(
		screen.getByRole("link", { name: "Play: Episode 1" }).getAttribute("href"),
	).toContain("version=source-v1");
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

function connectAnimeViewing(progress: number) {
	const fallback = requiredFetch(fetcher.getMockImplementation());
	const tracking: AnimeLibraryResponse["tracking"] = {
		provider: trackingProvider,
		accountId: "anilist:7",
		generation: "detail-fixture",
		state: "connected",
		fetchedAt: 1000,
		stale: false,
		refreshing: false,
		error: null,
	};
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path === "/api/tracking/account")
			return json({
				provider: trackingProvider,
				generation: tracking.generation,
				account: { id: "anilist:7", name: "Fixture" },
				state: "connected",
				connectivity: "available",
				checkedAt: 0,
			});
		if (path.startsWith("/api/tracking/entries/anilist%3Aanime%3A154587?"))
			return json({
				...tracking,
				entry: {
					id: "anilist:1",
					mediaId: "anilist:anime:154587",
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
		return fallback(input, init);
	});
}

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

test("detail reads viewing, subscription and activity through one aggregate request", async () => {
	mockAnime(animeFixture());
	renderApp("/anime/work-1");
	await screen.findByRole("heading", { name: "Frieren", level: 1 });
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

test("anime file actions locate and focus the file in its parent directory without starting playback", async () => {
	const detail = animeFixture();
	const episode = detail.episodes[0];
	if (!episode) throw Error("Missing episode");
	episode.versions = episode.versions.slice(0, 1);
	mockAnime(detail);
	renderApp("/anime/work-1");
	fireEvent.click(await screen.findByRole("button", { name: "File actions" }));
	const action = await screen.findByRole("menuitem", { name: "Show in Files" });
	expect(action.getAttribute("href")).toBe("/files/file-1/locate");
	fireEvent.click(action);
	await waitFor(() =>
		expect(screen.getByTestId("location").textContent).toBe(
			"/directories/season-1",
		),
	);
	const row = (
		await screen.findByRole("link", { name: "Episode 01.mp4" })
	).closest("li");
	expect(row?.id).toBe("file-file-1");
	expect(document.activeElement).toBe(row);
	expect(
		fetcher.mock.calls.some(
			([url]) => String(url) === "/api/playback/sessions",
		),
	).toBe(false);
});
