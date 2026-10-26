import type { WorkDetails, WorkReference, WorkSummary } from "./model.js";
import type * as Source from "./source-model.js";

function artworkUrl(reference: WorkReference, kind: "cover" | "banner") {
	return `/api/metadata/${reference.id}/artwork/${kind}/image`;
}

export function projectSummary(
	work: Source.WorkSummary,
	reference: WorkReference,
): WorkSummary {
	const data: WorkSummary = {
		unavailableFields: [] as string[],
		reference,
		titles: work.titles,
		year: work.year,
		format: work.format,
		status: work.status,
		episodeCount: work.episodeCount,
		nextAiringEpisode: work.nextAiringEpisode,
		airingSeason: work.airingSeason,
		coverUrl: work.coverUrl ? artworkUrl(reference, "cover") : null,
	};
	data.unavailableFields = [
		...new Set([
			...Object.entries(data)
				.filter(([, value]) => value === null)
				.map(([field]) => field),
			...work.unavailableFields.filter((field) => Object.hasOwn(data, field)),
		]),
	];
	return data;
}
export function projectDetails(
	work: Source.WorkDetails,
	reference: WorkReference,
): WorkDetails {
	const data: WorkDetails = {
		...projectSummary(work, reference),
		description: work.description,
		bannerUrl: work.bannerUrl ? artworkUrl(reference, "banner") : null,
		startDate: work.startDate,
		endDate: work.endDate,
		durationMinutes: work.durationMinutes,
		country: work.country,
		source: work.source,
		genres: work.genres,
		tags: work.tags,
		studios: work.studios.map(({ name }) => ({ name })),
		averageScore: work.averageScore,
		streamingEpisodes: work.streamingEpisodes,
		episodeCatalog: work.episodeCatalog,
	};
	data.unavailableFields = [
		...new Set([
			...Object.entries(data)
				.filter(([, value]) => value === null)
				.map(([field]) => field),
			...work.unavailableFields.filter((field) => Object.hasOwn(data, field)),
		]),
	];
	return data;
}
