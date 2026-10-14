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
	const sources =
		evidence.titleSources ??
		evidence.titles.map((title) => ({
			title,
			mode: "path" as const,
			distance: 0,
		}));
	const variants = (work: WorkCandidate) =>
		work.titleVariants ??
		work.titles.map((value) => ({
			value,
			kind: "unclassified" as const,
			language: null,
		}));
	const rawNumbers = (evidence.selectedEpisodes ?? evidence.rawEpisodes).map(
		Number,
	);
	const localScope = (work: WorkCandidate) =>
		rawNumbers.length > 0 &&
		rawNumbers.every(
			(number) =>
				Number.isSafeInteger(number) &&
				number > 0 &&
				work.episodeCount !== null &&
				number <= work.episodeCount,
		);
	const baseWorks = [...distinct.values()].filter(
		(work) =>
			localScope(work) &&
			variants(work).some((title) => title.kind === "primary") &&
			!variants(work).some(
				(title) =>
					title.kind === "primary" &&
					(titleEvidence(title.value).seasons.some(
						(season) => Number(season) > 1,
					) ||
						Number(titleEvidence(title.value).romanSeason) > 1),
			),
	);
	return [...distinct.values()]
		.map((work): RankedCandidate => {
			const reasons: string[] = [];
			const conflicts: string[] = [];
			const identityConflicts: string[] = [];
			const identityUnresolved: string[] = [];
			const assumptions: string[] = [];
			const hardConflict = (message: string) => {
				conflicts.push(message);
				identityConflicts.push(message);
			};
			const unknownIdentity = (message: string) => {
				conflicts.push(message);
				identityUnresolved.push(message);
			};
			const explicitMovie = evidence.inputs
				.find((input) => input.mode === "basename")
				?.elements.some(
					(element) =>
						element.kind === "type" && /^movie$/iu.test(element.value),
				);
			if (explicitMovie && work.format !== "MOVIE") {
				if (work.format === null)
					unknownIdentity(
						"Candidate format cannot verify the explicit movie type.",
					);
				else
					hardConflict("Explicit movie type contradicts the candidate format.");
			}
			let similarity = 0;
			let score = 0;
			let bestSource = "unclassified";
			for (const source of sources)
				for (const variant of variants(work)) {
					const input = normalize(titleEvidence(source.title).title);
					const target = normalize(titleEvidence(variant.value).title);
					if (!input || !target) continue;
					const exact = matchingTitle(
						source.title,
						variant.value,
						evidence.seasons,
						evidence.parts,
					);
					const ratio = Math.max(
						exact ? 1 : 0,
						fuzzy(input, target, { useSellers: false }),
					);
					const identity = exact || input === target;
					const sourceWeight =
						source.mode === "basename"
							? 12
							: source.mode === "ancestor"
								? Math.max(0, 10 - source.distance * 10)
								: 0;
					const pairScore =
						Math.round(ratio * 70) +
						(identity ? 15 : 0) +
						Math.round(ratio * sourceWeight) +
						(variant.kind === "primary" && identity ? 6 : 0);
					if (pairScore > score) {
						score = pairScore;
						similarity = ratio;
						bestSource = source.mode;
					}
				}
			reasons.push(
				`Strongest title evidence comes from ${bestSource}; provider primary titles have priority over aliases.`,
			);
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
				if (
					leafTitle &&
					work.titles.some((alias) =>
						matchingTitle(leafTitle, alias, evidence.seasons, evidence.parts),
					)
				)
					score += 12;
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
				hardConflict("Source series season evidence is contradictory.");
			if (seasons.length > 1)
				unknownIdentity("Candidate series season evidence is contradictory.");
			if (inputSeasons.length === 1) {
				if (seasons.length === 1) {
					if (seasons[0] === inputSeasons[0]) {
						score += 15;
						reasons.push(
							"Series season matches explicit title or metadata evidence.",
						);
					} else {
						score -= 20;
						hardConflict("Series season differs.");
					}
				} else if (inputSeasons[0] !== "1" && !completeContext)
					unknownIdentity(
						"Series season cannot be verified from metadata or a complete title match.",
					);
				else
					reasons.push(
						completeContext
							? "The complete contextual title identifies this work; its series season ordinal remains unknown."
							: "Series season is unknown; a first-season hint does not contradict this candidate.",
					);
			}
			if (
				inputSeasons.length === 0 &&
				sources.some(
					(source) =>
						(source.mode === "basename" ||
							(source.mode === "ancestor" && source.distance === 0)) &&
						work.titles.some(
							(title) =>
								normalize(titleEvidence(title).title) ===
								normalize(titleEvidence(source.title).title),
						) &&
						baseWorks.some((base) =>
							variants(base).some(
								(title) =>
									title.kind === "primary" &&
									matchingTitle(source.title, title.value, [], evidence.parts),
							),
						),
				)
			) {
				const primaryLater = variants(work).filter(
					(title) =>
						title.kind === "primary" &&
						(titleEvidence(title.value).seasons.some(
							(season) => Number(season) > 1,
						) ||
							Number(titleEvidence(title.value).romanSeason) > 1),
				);
				const aliasLater = variants(work).filter(
					(title) =>
						title.kind === "alias" &&
						titleEvidence(title.value).seasons.some(
							(season) => Number(season) > 1,
						),
				);
				const completeOrdinalSource = primaryLater.some((title) =>
					sources.some(
						(source) =>
							(source.mode === "basename" ||
								(source.mode === "ancestor" && source.distance === 0)) &&
							normalize(source.title) === normalize(title.value),
					),
				);
				if (primaryLater.length && !completeOrdinalSource) {
					score -= identificationPolicy.missingSeasonPrimaryPenalty;
					assumptions.push(
						"No source season is specified; an explicitly numbered sequel is less likely than a locally in-scope base work.",
					);
				} else if (!primaryLater.length && aliasLater.length) {
					score -=
						(identificationPolicy.missingSeasonAliasPenalty *
							aliasLater.length) /
						Math.max(
							1,
							variants(work).filter((title) => title.kind === "alias").length,
						);
					assumptions.push(
						"Only aliases suggest a later season; the missing-season preference is weak.",
					);
				} else if (!primaryLater.length && localScope(work)) {
					assumptions.push(
						"Missing-season base-work preference uses locally in-scope numbering; the source season remains unknown.",
					);
				}
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
					hardConflict("Release year differs.");
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
				unknownIdentity("Candidate part evidence is contradictory.");
			if (inputParts.length > 1)
				hardConflict("Source part evidence is contradictory.");
			if (inputParts.length) {
				if (!parts.length)
					unknownIdentity("Part cannot be verified from metadata.");
				else if (
					parts.length === 1 &&
					inputParts.length === 1 &&
					parts[0] === inputParts[0]
				) {
					score += 10;
					reasons.push("Part matches explicit title or metadata evidence.");
				} else if (parts.length === 1 && inputParts.length === 1) {
					score -= 20;
					hardConflict("Part differs.");
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
				identityConflicts,
				identityUnresolved,
				assumptions,
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
