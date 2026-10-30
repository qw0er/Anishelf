import type { AnimeLibraryResponse } from "../../../../src/shared/api/contracts.js";
import { trackingProvider } from "../../../support/tracking-fixture.js";
import { fetcher, json, requiredFetch } from "../../support/state.js";

export function connectAnimeViewing(progress: number) {
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
