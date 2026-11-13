import type {
	LocalWorkDetailResponse,
	MetadataAiringResponse,
	MetadataDetailsResponse,
} from "../../../shared/api/contracts.js";
import { airedEpisodeCount, type Episode } from "./detail-format.js";

/** A stale schedule can confirm its past, but cannot advance merely because time passed. */
export function confirmedEpisodeCount(
	metadata: MetadataDetailsResponse | null,
	pages: readonly MetadataAiringResponse[],
	now: number,
): number | null {
	let count = metadata
		? airedEpisodeCount(metadata.data, Math.min(now, metadata.fetchedAt))
		: null;
	let upcoming = Infinity;
	for (const page of pages) {
		const cutoff = Math.min(now, page.fetchedAt);
		for (const item of page.data.items) {
			if (!page.stale && !page.refreshError && item.airingAt * 1000 > cutoff)
				upcoming = Math.min(upcoming, item.episode - 1);
			if (
				Number.isSafeInteger(item.episode) &&
				item.episode > 0 &&
				item.airingAt * 1000 <= cutoff
			)
				count = Math.max(count ?? 0, item.episode);
		}
	}
	if (Number.isFinite(upcoming)) count = Math.min(count ?? upcoming, upcoming);
	if (metadata?.data.episodeCount != null && count !== null)
		count = Math.min(count, metadata.data.episodeCount);
	return count;
}

/** View-only placeholders never create Catalog records or trigger source discovery. */
export function episodeTimeline(input: {
	workId: string;
	format: string | null;
	episodes: readonly Episode[];
	aired: number | null;
	episodeLabel(number: number): string;
}): LocalWorkDetailResponse["episodes"] {
	const byNumber = new Map(
		input.episodes.map((episode) => [
			`${episode.kind}:${episode.number}`,
			episode,
		]),
	);
	if (input.format !== "MOVIE") {
		for (
			let number = 1;
			number <= Math.min(input.aired ?? 0, 10000);
			number++
		) {
			const key = `regular:${number}`;
			if (!byNumber.has(key))
				byNumber.set(key, {
					id: `aired:${input.workId}:${number}`,
					workId: input.workId,
					kind: "regular",
					number: String(number),
					label: input.episodeLabel(number),
					provenance: "count-derived",
					versions: [],
					availability: "missing",
				});
		}
	}
	const order = { regular: 0, special: 1, movie: 2 };
	return [...byNumber.values()]
		.filter(
			(episode) =>
				episode.versions.some((version) => version.available) ||
				(episode.kind === "regular" &&
					/^\d+$/.test(episode.number) &&
					input.aired !== null &&
					Number(episode.number) >= 1 &&
					Number(episode.number) <= input.aired),
		)
		.sort(
			(a, b) =>
				order[a.kind] - order[b.kind] ||
				a.number.localeCompare(b.number, "en", { numeric: true }) ||
				a.id.localeCompare(b.id),
		);
}
