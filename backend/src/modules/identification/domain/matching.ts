import { fuzzy } from "fast-fuzzy";
import { identificationPolicy } from "../policy.js";
import type {
	ExtractionEvidence,
	RankedCandidate,
	WorkCandidate,
} from "./model.js";

function normalize(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}
export function rankCandidates(
	evidence: ExtractionEvidence,
	works: WorkCandidate[],
): RankedCandidate[] {
	const distinct = new Map(
		works.map((work) => [JSON.stringify(work.reference), work]),
	);
	return [...distinct.values()]
		.map((work): RankedCandidate => {
			const reasons: string[] = [];
			const conflicts: string[] = [];
			let similarity = 0;
			for (const title of evidence.titles)
				for (const alias of work.titles) {
					const input = normalize(title);
					const target = normalize(alias);
					if (input && target)
						similarity = Math.max(
							similarity,
							fuzzy(input, target, { useSellers: false }),
						);
				}
			let score = Math.round(similarity * 70);
			reasons.push(
				similarity === 1
					? "An extracted title matches a title or alias."
					: "Title or alias similarity contributes to ranking.",
			);
			const years = evidence.years.map(Number);
			if (work.year !== null && years.length) {
				if (years.includes(work.year)) {
					score += 10;
					reasons.push("Release year matches.");
				} else {
					score -= 15;
					conflicts.push("Release year differs.");
				}
			}
			for (const [hints, value, label] of [
				[evidence.seasons, work.season, "Series season"],
				[evidence.parts, work.part, "Part"],
			] as const) {
				if (hints.length && value !== null) {
					if (
						hints.some(
							(hint) =>
								normalize(hint).replace(/^0+/, "") ===
								normalize(value).replace(/^0+/, ""),
						)
					) {
						score += 10;
						reasons.push(`${label} matches.`);
					} else {
						score -= 20;
						conflicts.push(`${label} differs.`);
					}
				} else if (hints.length)
					conflicts.push(`${label} cannot be verified from metadata.`);
			}
			if (work.format === "MOVIE" && evidence.rawEpisodes.length)
				conflicts.push("Episode numbering is present for a movie.");
			if (
				work.episodeCount !== null &&
				evidence.rawEpisodes.some(
					(token) =>
						/^\d+$/.test(token) && Number(token) > (work.episodeCount ?? 0),
				)
			)
				conflicts.push(
					"Release numbering exceeds the known episode count; an explicit correction may be needed.",
				);
			return {
				work,
				score: Math.max(0, score),
				reasons,
				conflicts,
				matcherVersion: identificationPolicy.matcherVersion,
			};
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				JSON.stringify(a.work.reference).localeCompare(
					JSON.stringify(b.work.reference),
				),
		)
		.slice(0, identificationPolicy.maximumCandidates);
}
