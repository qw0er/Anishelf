import type { CatalogSourceResponse } from "../../../src/shared/api/contracts.js";

export function playbackTitleFixture(): CatalogSourceResponse {
	return {
		sourceVersion: "version",
		associations: [1, 2].map((number) => ({
			workId: "work-1",
			workTitle: "Local Frieren",
			episodeId: `episode-${number}`,
			kind: "regular",
			number: String(number),
			label: "Custom episode title",
		})),
	};
}
