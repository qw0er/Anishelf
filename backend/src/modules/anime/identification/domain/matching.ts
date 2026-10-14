import { fuzzy } from "fast-fuzzy";
import { identificationPolicy } from "../policy.js";
import type {
	ExtractionEvidence,
	RankedCandidate,
	WorkCandidate,
} from "./model.js";
import {
	matchingTitle,
	normalizeTitle as normalize,
	titleEvidence,
} from "./title-evidence.js";

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
					const input = normalize(titleEvidence(title).title);
					const target = normalize(titleEvidence(alias).title);
					if (input && target)
						similarity = Math.max(
							similarity,
							fuzzy(input, target, { useSellers: false }),
						);
				}
			let score = Math.round(similarity * 70);
			const exact = evidence.titles.some((title) =>
				work.titles.some((alias) => matchingTitle(title, alias)),
			);
			const leafTitle = evidence.inputs
				.find((input) => input.mode === "basename")
				?.elements.find((element) => element.kind === "title")?.value;
			if (
				evidence.titles.some(
					(title) =>
						normalize(title) !== normalize(leafTitle ?? title) &&
						work.titles.some((alias) => normalize(title) === normalize(alias)),
				)
			) {
				score += 15;
				reasons.push("A complete contextual title matches a title or alias.");
			}
			const titleSeasons = work.titles.flatMap(
				(title) => titleEvidence(title).seasons,
			);
			const romanSeasons = work.titles.flatMap((title) => {
				const ordinal = titleEvidence(title).romanSeason;
				const contextualMatch = evidence.titles.some(
					(input) =>
						normalize(input) !== normalize(leafTitle ?? input) &&
						normalize(input) === normalize(title),
				);
				return ordinal && contextualMatch ? [ordinal] : [];
			});
			const seasons = [
				...new Set([
					...(work.season === null ? [] : [String(Number(work.season))]),
					...titleSeasons,
					...romanSeasons,
				]),
			];
			const inputSeasons = [
				...new Set(evidence.seasons.map((season) => String(Number(season)))),
			];
			if (inputSeasons.length > 1)
				conflicts.push("Source series season evidence is contradictory.");
			if (seasons.length > 1)
				conflicts.push("Candidate series season evidence is contradictory.");
			if (inputSeasons.length === 1) {
				if (seasons.length === 1) {
					if (seasons[0] === inputSeasons[0]) {
						score += 15;
						reasons.push(
							"Series season matches explicit title or metadata evidence.",
						);
					} else {
						score -= 20;
						conflicts.push("Series season differs.");
					}
				} else if (inputSeasons[0] !== "1")
					conflicts.push(
						"Series season cannot be verified from metadata or a complete title match.",
					);
				else
					reasons.push(
						"Series season is unknown; a first-season hint does not contradict this candidate.",
					);
			}
			if (exact)
				reasons.push(
					"An extracted title matches a title or alias after explicit season normalization.",
				);
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
