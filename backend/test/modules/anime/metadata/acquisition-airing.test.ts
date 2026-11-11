import { expect, test } from "vitest";
import { AnimeReleaseAssessment } from "../../../../src/modules/anime/release-assessment/application.js";
import {
	media,
	setup,
	setupTestLifecycle,
	transport,
} from "./support/metadata-fixture.js";

setupTestLifecycle();
test("acquisition receives Unix milliseconds and cache freshness without a time zone conversion", async () => {
	const unixSeconds = 1793511000,
		fetchedAt = unixSeconds * 1000 - 3600_000;
	const fetcher = transport();
	fetcher.mockResolvedValue(
		Response.json({
			data: {
				Media: {
					...media(),
					status: "RELEASING",
					nextAiringEpisode: { episode: 3, airingAt: unixSeconds },
				},
			},
		}),
	);
	const f = await setup(fetcher, () => fetchedAt);
	const assessment = new AnimeReleaseAssessment(
		{
			extractRelease: () => {
				throw Error("not used");
			},
		},
		f.publicMetadata,
		undefined,
		f.publicMetadata.identities,
	);
	expect(
		(await assessment.target("anilist:anime:154587")).airing,
	).toMatchObject({
		status: "RELEASING",
		nextEpisode: { episode: 3, airingAt: unixSeconds * 1000 },
		fetchedAt,
		stale: false,
		refreshError: false,
	});
});
