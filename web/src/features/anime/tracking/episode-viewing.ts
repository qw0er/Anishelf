export interface TrackingEpisode {
	kind: string;
	number: string;
	versions: { available: boolean }[];
}
/** Cumulative Tracking progress; specials/fractional numbers remain unknown. */
export function episodeViewing(
	episode: TrackingEpisode,
	progress: number | null,
): "watched" | "unwatched" | "unknown" {
	if (
		progress === null ||
		!["regular", "movie"].includes(episode.kind) ||
		!/^[1-9][0-9]*$/.test(episode.number)
	)
		return "unknown";
	return Number(episode.number) <= progress ? "watched" : "unwatched";
}
export function episodeViewingCounts(
	episodes: TrackingEpisode[],
	progress: number | null,
) {
	return {
		watched: episodes.filter((e) => episodeViewing(e, progress) === "watched")
			.length,
		availableUnwatched: episodes.filter(
			(e) =>
				episodeViewing(e, progress) === "unwatched" &&
				e.versions.some((v) => v.available),
		).length,
	};
}
