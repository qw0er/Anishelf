import type { WorkCandidate } from "./model.ts";
import { titleEvidence } from "./title-evidence.ts";

/** Provider title ordinals express series scope. Calendar seasons describe airing. */
export function workCandidate(
	work: Pick<
		WorkCandidate,
		"reference" | "year" | "format" | "episodeCount"
	> & {
		titles: readonly { value: string; kind: string; language: string | null }[];
	},
	snapshotId: string,
): WorkCandidate {
	const titles = work.titles.map(({ value }) => value);
	const evidence = titles.map(titleEvidence);
	const seasons = [...new Set(evidence.flatMap((title) => title.seasons))];
	const parts = [...new Set(evidence.flatMap((title) => title.parts))];

	return {
		reference: work.reference,
		snapshotId,
		titles,
		titleVariants: work.titles.map(({ value, kind, language }) => ({
			value,
			kind: kind === "alias" ? "alias" : "primary",
			language,
		})),
		year: work.year,
		format: work.format,
		episodeCount: work.episodeCount,
		season: seasons.length === 1 ? (seasons[0] ?? null) : null,
		part: parts.length === 1 ? (parts[0] ?? null) : null,
		ordinalSource: "provider-title",
	};
}
