// @vitest-environment happy-dom

import { expect, test } from "vitest";
import type { AnimeLibraryResponse } from "../../../src/shared/api/contracts.js";
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
import { appFixture, fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

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
