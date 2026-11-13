// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { useEpisodeTimeline } from "../../../src/features/anime/catalog/use-episode-timeline.js";
import { animeFixture } from "../../fixtures/anime.js";
import { queryClient } from "../../setup.js";
import { act, cleanup, renderHook } from "../../support/query-test-utils.js";

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test("a stale failed refresh preserves confirmed rows and does not advance from older schedule evidence", () => {
	vi.useFakeTimers();
	vi.setSystemTime(2_000_000);
	const metadata = animeFixture().metadata;
	metadata.stale = false;
	metadata.data.episodeCount = null;
	metadata.data.status = "RELEASING";
	metadata.data.nextAiringEpisode = { episode: 4, airingAt: 3000 };
	const hook = renderHook(
		({ snapshot }) => useEpisodeTimeline("remote", snapshot, [], []),
		{ initialProps: { snapshot: metadata } },
	);
	expect(hook.result.current.episodes).toHaveLength(3);
	const failed = structuredClone(metadata);
	failed.stale = true;
	failed.refreshError = {
		code: "unavailable",
		message: "Unavailable",
		retryAt: null,
	};
	failed.data.nextAiringEpisode = { episode: 9, airingAt: 3000 };
	hook.rerender({ snapshot: failed });
	expect(hook.result.current.episodes).toHaveLength(3);
});

test("an open detail invalidates its metadata and schedule at a known airtime", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(2_000_000);
	const invalidations = vi
		.spyOn(queryClient, "invalidateQueries")
		.mockResolvedValue();
	const metadata = animeFixture().metadata;
	metadata.fetchedAt = Date.now();
	metadata.stale = false;
	metadata.data.status = "RELEASING";
	metadata.data.nextAiringEpisode = { episode: 3, airingAt: 2001 };
	const hook = renderHook(
		({ snapshot }) => useEpisodeTimeline("remote", snapshot, [], []),
		{ initialProps: { snapshot: metadata } },
	);
	expect(hook.result.current.episodes).toHaveLength(2);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1001);
	});
	expect(invalidations).toHaveBeenCalledWith({ queryKey: ["anime-detail"] });
	expect(invalidations).toHaveBeenCalledWith({
		queryKey: ["metadata-airing", metadata.data.reference.id],
	});
	expect(hook.result.current.episodes).toHaveLength(2);
	hook.rerender({ snapshot: { ...metadata, fetchedAt: Date.now() } });
	expect(hook.result.current.episodes).toHaveLength(3);
});
