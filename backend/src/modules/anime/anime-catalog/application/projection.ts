import {
	airedEpisodeCount,
	type WorkDetails,
	workTitle,
} from "../../metadata/public.js";
import type { LocalWork } from "../domain/model.js";

export function projection(work: LocalWork, metadata: WorkDetails): LocalWork {
	return {
		...work,
		providerTitle: workTitle(
			metadata.titles,
			`Untitled ${metadata.reference.id}`,
		),
		searchTitles: metadata.titles.map((title) => title.value),
		format: metadata.format,
		year: metadata.year,
		episodeCount: metadata.episodeCount,
		airedEpisodeCount: airedEpisodeCount(metadata),
	};
}
