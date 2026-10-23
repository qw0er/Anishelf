import { episodeViewing } from "../tracking/public.js";
import type { Episode } from "./detail-format.js";

/** First available episode after the provider's cumulative progress. */
export function nextPlayableEpisode(
	episodes: readonly Episode[],
	progress: number | null,
): Episode | null {
	if (progress === null) return null;
	return (
		[...episodes]
			.filter((episode) => {
				return (
					episodeViewing(episode, progress) === "unwatched" &&
					episode.versions.some((version) => version.available)
				);
			})
			.sort(
				(a, b) =>
					Number(a.number) - Number(b.number) || a.id.localeCompare(b.id),
			)[0] ?? null
	);
}
