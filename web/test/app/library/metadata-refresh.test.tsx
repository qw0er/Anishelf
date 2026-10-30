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
import { fetcher, json, requiredFetch } from "../support/state.js";

setupAppTest();

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
