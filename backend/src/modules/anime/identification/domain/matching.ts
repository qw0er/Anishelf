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
			const explicitMovie = evidence.inputs
				.find((input) => input.mode === "basename")
				?.elements.some(
					(element) =>
						element.kind === "type" && /^movie$/iu.test(element.value),
				);
			if (explicitMovie && work.format !== "MOVIE")
				conflicts.push("Explicit movie type contradicts the candidate format.");
			let similarity = 0;
			let equivalentTitleText = false;
			for (const title of evidence.titles)
				for (const alias of work.titles) {
					const input = normalize(titleEvidence(title).title);
					const target = normalize(titleEvidence(alias).title);
					if (input && input === target) equivalentTitleText = true;
					if (input && target)
						similarity = Math.max(
							similarity,
							matchingTitle(title, alias, evidence.seasons, evidence.parts)
								? 1
								: 0,
							fuzzy(input, target, { useSellers: false }),
						);
				}
			let score = Math.round(similarity * 70);
			if (explicitMovie) {
				score += work.format === "MOVIE" ? 20 : -20;
				if (work.format === "MOVIE")
					reasons.push("Explicit movie type matches the candidate format.");
			}
			const exact = evidence.titles.some((title) =>
				work.titles.some((alias) =>
					matchingTitle(title, alias, evidence.seasons, evidence.parts),
				),
			);
			if (equivalentTitleText || exact) {
				score += 15;
				reasons.push(
					"Canonical title text matches; ordinal evidence is evaluated separately.",
				);
			}
			const leafTitle = evidence.inputs
				.find((input) => input.mode === "basename")
				?.elements.find((element) => element.kind === "title")?.value;
			// A parsed directory title may have lost its ordinal. Keep the complete
			// name for context matching, and only reuse stripped titles when no
			// season marker was removed from that directory.
			const contextualTitles = evidence.inputs
				.filter((input) => input.mode === "ancestor")
				.flatMap((input) => [
					input.input,
					...(input.elements.some((element) => element.kind === "season") ||
					titleEvidence(input.input).seasons.length
						? []
						: input.elements
								.filter((element) => element.kind === "title")
								.map((element) => element.value)),
				]);
			const contextualMatch = (title: string) =>
				contextualTitles.some(
					(input) =>
						normalize(input) !== normalize(leafTitle ?? input) &&
						normalize(input) === normalize(title),
				);
			const completeContext = work.titles.some(contextualMatch);
			if (completeContext) {
				score += 15;
				reasons.push("A complete contextual title matches a title or alias.");
			}
			const titleSeasons = work.titles.flatMap(
				(title) => titleEvidence(title).seasons,
			);
			const romanSeasons = work.titles.flatMap((title) => {
				const ordinal = titleEvidence(title).romanSeason;
				return ordinal && contextualMatch(title) ? [ordinal] : [];
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
				} else if (inputSeasons[0] !== "1" && !completeContext)
					conflicts.push(
						"Series season cannot be verified from metadata or a complete title match.",
					);
				else
					reasons.push(
						completeContext
							? "The complete contextual title identifies this work; its series season ordinal remains unknown."
							: "Series season is unknown; a first-season hint does not contradict this candidate.",
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
			const parts = [
				...new Set([
					...(work.part === null ? [] : [String(Number(work.part))]),
					...work.titles.flatMap((title) => titleEvidence(title).parts),
				]),
			];
			const inputParts = [
				...new Set(evidence.parts.map((part) => String(Number(part)))),
			];
			if (parts.length > 1)
				conflicts.push("Candidate part evidence is contradictory.");
			if (inputParts.length > 1)
				conflicts.push("Source part evidence is contradictory.");
			if (inputParts.length) {
				if (!parts.length)
					conflicts.push("Part cannot be verified from metadata.");
				else if (
					parts.length === 1 &&
					inputParts.length === 1 &&
					parts[0] === inputParts[0]
				) {
					score += 10;
					reasons.push("Part matches explicit title or metadata evidence.");
				} else {
					score -= 20;
					conflicts.push("Part differs.");
				}
			}
			if (work.format === "MOVIE" && evidence.rawEpisodes.length)
				conflicts.push("Episode numbering is present for a movie.");
			if (
				work.episodeCount !== null &&
				(evidence.selectedEpisodes ?? evidence.rawEpisodes).some(
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
