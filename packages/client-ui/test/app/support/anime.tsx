import type {
	TrackingAccountResponse,
	TrackingEntryResponse,
} from "../../../src/shared/api/contracts.js";
import {
	animeDetailFixture,
	type animeFixture,
	animeStatusFixture,
} from "../../fixtures/anime.js";

import { disconnectedList, fetcher, json, requiredFetch } from "./state.js";

async function fixtureViewing(
	key: string,
): Promise<TrackingEntryResponse | undefined> {
	const implementation = requiredFetch(fetcher.getMockImplementation());
	const account = (await (
		await implementation("/api/tracking/account")
	).json()) as TrackingAccountResponse;
	if (!account.account) return undefined;
	return (
		await implementation(
			`/api/tracking/entries/${encodeURIComponent(key)}?generation=${account.generation}`,
		)
	).json() as Promise<TrackingEntryResponse>;
}
export function mockAnime(detail: ReturnType<typeof animeFixture>) {
	const fallback = fetcher.getMockImplementation();
	fetcher.mockImplementation(async (input, init) => {
		const path = String(input);
		if (path.startsWith("/api/anime/library?"))
			return json({
				items: [
					{
						...detail.work,
						reference: animeDetailFixture(detail).reference,
						localWorkId: detail.work.id,
						viewing: null,
					},
				],
				page: Number(
					new URL(path, "http://localhost").searchParams.get("page") ?? 1,
				),
				perPage: 24,
				hasNextPage: true,
				localState: "available",
				tracking: disconnectedList,
			});
		if (path.startsWith("/api/anime/status/")) {
			const key = decodeURIComponent(path.slice("/api/anime/status/".length));
			return json(animeStatusFixture(await fixtureViewing(key)));
		}

		if (path === "/api/anime/details/local/work-1") {
			const key = "anilist:anime:154587";
			return json(animeDetailFixture(detail, await fixtureViewing(key)));
		}
		if (path.startsWith("/api/anime/details/works/")) {
			const key = decodeURIComponent(
				path.slice("/api/anime/details/works/".length),
			);
			const viewing = await fixtureViewing(key);
			const id = decodeURIComponent(key.split(":")[2] ?? "");
			const response = await requiredFetch(fetcher.getMockImplementation())(
				id === "154587"
					? "/api/metadata/metadata-work-1"
					: `/api/metadata/missing-${encodeURIComponent(id)}`,
			);
			return json({
				...animeDetailFixture(detail, viewing),
				reference: { provider: "anilist", mediaType: "anime", id },
				local: null,
				displayTitle: viewing?.entry?.titles[0] ?? key,
				metadata: response.ok ? await response.json() : null,
				metadataError: response.ok
					? null
					: { code: "unavailable", message: "Unavailable", retryAt: null },
			});
		}
		if (path === "/api/catalog/works/work-1/refresh") return json(detail);
		if (path.startsWith("/api/metadata/metadata-work-1/relations"))
			return json({
				snapshotId: "relations",
				fetchedAt: 1,
				stale: false,
				refreshing: false,
				refreshError: null,
				data: { items: [], page: 1, perPage: 25, hasNextPage: false },
			});
		if (!fallback) throw new Error("Missing fetch fixture");
		return fallback(input, init);
	});
}
