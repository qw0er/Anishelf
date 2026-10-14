import type { WorkDetails } from "../../metadata/public.js";
import type { LocalWork } from "../domain/model.js";

export function projection(work: LocalWork, metadata: WorkDetails): LocalWork {
	return {
		...work,
		providerTitle:
			metadata.titles.find((title) => title.kind === "native")?.value ??
			metadata.titles[0]?.value ??
			`Untitled ${metadata.reference.id}`,
		searchTitles: metadata.titles.map((title) => title.value),
		format: metadata.format,
		year: metadata.year,
		episodeCount: metadata.episodeCount,
	};
}
