import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	automaticBlockers,
	automaticProposal,
	recognizedWorkProposal,
} from "../../src/modules/anime/anime-catalog/domain/admission.js";
import type { ReviewRecord } from "../../src/modules/anime/anime-catalog/domain/model.js";
import { IdentificationApplication } from "../../src/modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../../src/modules/anime/identification/infrastructure/parser.js";
import { identificationPolicy } from "../../src/modules/anime/identification/policy.js";
import type {
	IdentificationResult,
	WorkCandidate,
} from "../../src/modules/anime/identification/public.js";
import { type AnimeCase, corpusDirectory, loadCorpus } from "./anime-corpus.js";
import { productionNumbering } from "./production-numbering.js";

interface Snapshot {
	anilist: {
		id: number;
		titles: Record<string, string | null>;
		synonyms: string[];
		format: string;
		episodes: number | null;
		startDate: { year: number | null };
	};
}
function groupSummary(
	rows: {
		id: string;
		expectedDecision: string;
		expectedWorkId: string | null;
		recognizedWorkId: string | null;
		admittedWorkId: string | null;
		unsafe: boolean;
		missed: boolean;
	}[],
) {
	return {
		total: rows.length,
		expectedMatches: rows.filter((row) => row.expectedDecision === "match")
			.length,
		recognizedMatches: rows.filter(
			(row) =>
				row.expectedDecision === "match" &&
				row.recognizedWorkId === row.expectedWorkId,
		).length,
		correctAdmissions: rows.filter((row) => row.admittedWorkId && !row.unsafe)
			.length,
		unsafeAdmissions: rows.filter((row) => row.unsafe).map((row) => row.id),
		missedMatches: rows.filter((row) => row.missed).map((row) => row.id),
	};
}
export async function matchingCorpusCandidates() {
	const corpus = await loadCorpus();
	const candidates = await Promise.all(
		corpus.works.map(async (work) => {
			const { anilist } = JSON.parse(
				await readFile(join(corpusDirectory, work.snapshot), "utf8"),
			) as Snapshot;
			return {
				workId: work.id,
				candidate: {
					reference: {
						id: String(anilist.id),
					},
					snapshotId: work.snapshot,
					titles: [
						...Object.values(anilist.titles),
						...anilist.synonyms,
					].filter((title): title is string => Boolean(title)),
					titleVariants: [
						...Object.entries(anilist.titles).flatMap(([language, value]) =>
							value ? [{ value, kind: "primary" as const, language }] : [],
						),
						...anilist.synonyms.map((value) => ({
							value,
							kind: "alias" as const,
							language: null,
						})),
					],
					year: anilist.startDate.year,
					format: anilist.format,
					episodeCount: anilist.episodes,
					season: null,
					part: null,
				} satisfies WorkCandidate,
			};
		}),
	);
	return { corpus, candidates };
}
function review(result: IdentificationResult): ReviewRecord {
	return {
		...result,
		id: result.source.fileId,
		sourceId: result.source.fileId,
		rootId: "corpus",
		fileId: result.source.fileId,
		relativePath: result.source.relativePath,
		scopeId: result.source.scopeId,
		sourceVersion: result.source.sourceVersion,
		available: true,
		revision: 1,
		decision: "pending",
		reason: null,
	};
}
export async function evaluateMatchingCorpus() {
	const { corpus, candidates } = await matchingCorpusCandidates();
	const production = await productionNumbering(corpus);
	const ids = new Map(
		candidates.map(({ workId, candidate }) => [candidate.reference.id, workId]),
	);
	// All frozen works compete for every query. Never select candidates using the
	// expected answer; this evaluates ranking/admission, not live search recall.
	const engine = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		metadata: {
			search: async () => candidates.map(({ candidate }) => candidate),
		},
	});
	const rows = [];
	const groups: { id: string; entry: AnimeCase; path: string }[][] =
		corpus.cases.flatMap((entry) =>
			entry.input.kind === "file"
				? [[{ id: entry.id, entry, path: entry.input.relativePath }]]
				: [],
		);
	for (const scenario of corpus.scenarios)
		groups.push(
			scenario.resources.map((resource) => {
				const entry = corpus.cases.find(
					(entry) => entry.id === resource.caseId,
				);
				if (!entry) throw new Error(`Missing scenario case ${resource.caseId}`);
				return {
					id: `${scenario.id}:${entry.id}`,
					entry,
					path: resource.relativePath,
				};
			}),
		);
	for (const group of groups) {
		const results = await engine.identify(
			group.map(({ id, path }) => ({
				scopeId: "/corpus",
				fileId: id,
				relativePath: path,
				sourceVersion: corpus.version,
			})),
		);
		for (const [index, result] of results.entries()) {
			const item = group[index];
			if (!item) throw new Error("Missing corpus input");
			const record = review(result);
			const proposal = automaticProposal(record);
			const recognized = recognizedWorkProposal(record);
			const workId = proposal
				? (ids.get(proposal.candidate.work.reference.id) ?? null)
				: null;
			const expected = item.entry.expected;
			const productionLabel = production.rows.get(item.entry.id);
			const selectedNumberingDiffers = Boolean(
				result.evidence.selectedEpisodes &&
					JSON.stringify(result.evidence.selectedEpisodes.map(Number)) !==
						JSON.stringify(expected.episodes),
			);
			const transformedNumbering = Boolean(
				proposal?.mapping.numbering ||
					(result.evidence.selectedEpisodes &&
						JSON.stringify(result.evidence.selectedEpisodes.map(Number)) !==
							JSON.stringify(result.evidence.rawEpisodes.map(Number))),
			);
			const expectedMovie =
				candidates.find((work) => work.workId === expected.workId)?.candidate
					.format === "MOVIE";
			const candidateIds = result.proposals.map(
				({ candidate }) => ids.get(candidate.work.reference.id) ?? null,
			);
			const unsafeIdentity = Boolean(
				proposal &&
					(expected.decision !== "match" || workId !== expected.workId),
			);
			// Bangumi sort values are not production AniList season-local numbering.
			// Compare only unchanged, positive integer release numbers, or whole movies.
			const comparable =
				expected.decision === "match" &&
				(Boolean(productionLabel) ||
					expectedMovie ||
					Boolean(
						expected.episodes?.length &&
							expected.parsed.rawEpisodes?.length &&
							JSON.stringify(expected.episodes) ===
								JSON.stringify(expected.parsed.rawEpisodes) &&
							!proposal?.mapping.numbering &&
							!(transformedNumbering && selectedNumberingDiffers) &&
							expected.episodes.every(
								(number) => Number.isInteger(number) && number > 0,
							),
					));
			const expectedTargets = expectedMovie
				? ["whole"]
				: (productionLabel?.targets ?? expected.episodes?.map(String));
			const actualTargets =
				proposal?.mapping.targets.map((target) => target.number) ?? [];
			const episodeMismatch = Boolean(
				proposal &&
					comparable &&
					JSON.stringify(expectedTargets) !== JSON.stringify(actualTargets),
			);
			const unsafe = unsafeIdentity || episodeMismatch;
			const blockers = automaticBlockers(record);
			rows.push({
				id: item.id,
				path: item.path,
				tags: item.entry.tags,
				expectedDecision: expected.decision,
				expectedWorkId: expected.workId,
				expectedEpisodes: expected.episodes,
				expectedProductionTargets: productionLabel?.targets,
				episodeComparisonBasis: productionLabel
					? "frozen-season-local-label"
					: comparable
						? "unchanged-numbering"
						: "unverified-numbering-system",
				rawEpisodes: result.evidence.rawEpisodes,
				selectedEpisodes: result.evidence.selectedEpisodes,
				mappingNumbering: proposal?.mapping.numbering,
				numbering: result.evidence.numbering,
				contentKind: result.evidence.contentKind,
				selectedNumberingDiffers:
					expected.decision === "match" &&
					!expectedMovie &&
					selectedNumberingDiffers,
				targetNumberingDiffers:
					expected.decision === "match" &&
					!expectedMovie &&
					Boolean(proposal) &&
					JSON.stringify(actualTargets.map(Number)) !==
						JSON.stringify(expected.episodes),
				candidateIds,
				recognizedWorkId: recognized
					? (ids.get(recognized.candidate.work.reference.id) ?? null)
					: null,
				admittedWorkId: workId,
				targets: actualTargets,
				unsafe,
				episodeComparison: comparable
					? episodeMismatch
						? "mismatch"
						: proposal
							? "matched"
							: "not-admitted"
					: "not-comparable",
				missed: expected.decision === "match" && !proposal,
				blockers: proposal ? [] : blockers,
				stages: {
					candidateFound: candidateIds.includes(expected.workId ?? null),
					correctTop1: candidateIds[0] === expected.workId,
					mappingResolved: Boolean(
						recognized?.mapping.targets.length &&
							!recognized?.mapping.unresolved.length,
					),
					admitted: Boolean(proposal),
				},
				candidates: result.proposals.map(({ candidate, mapping }) => ({
					workId: ids.get(candidate.work.reference.id),
					score: candidate.score,
					reasons: candidate.reasons,
					conflicts: candidate.conflicts,
					identityConflicts: candidate.identityConflicts,
					identityUnresolved: candidate.identityUnresolved,
					assumptions: candidate.assumptions,
					unresolved: mapping.unresolved,
					numbering: mapping.numbering,
				})),
			});
		}
	}
	const summary = {
		total: rows.length,
		fileCases: corpus.cases.filter((entry) => entry.input.kind === "file")
			.length,
		scenarioFiles: corpus.scenarios.reduce(
			(sum, scenario) => sum + scenario.resources.length,
			0,
		),
		excludedPublicationTitles: corpus.cases.filter(
			(entry) => entry.input.kind === "release-title",
		).length,
		admitted: rows.filter((row) => row.admittedWorkId).length,
		recognizedMatches: rows.filter(
			(row) =>
				row.expectedDecision === "match" &&
				row.recognizedWorkId === row.expectedWorkId,
		).length,
		correctAdmissions: rows.filter((row) => row.admittedWorkId && !row.unsafe)
			.length,
		unsafeAdmissions: rows.filter((row) => row.unsafe).map((row) => row.id),
		missedMatches: rows.filter((row) => row.missed).map((row) => row.id),
		episodeMismatches: rows
			.filter((row) => row.episodeComparison === "mismatch")
			.map((row) => row.id),
		expectedMatches: rows.filter((row) => row.expectedDecision === "match")
			.length,
		expectedMatchTop5: rows.filter(
			(row) =>
				row.expectedDecision === "match" &&
				row.candidateIds.slice(0, 5).includes(row.expectedWorkId),
		).length,
		comparableAdmittedEpisodes: rows.filter(
			(row) => row.admittedWorkId && row.episodeComparison !== "not-comparable",
		).length,
		admittedDifferentNumbering: rows.filter(
			(row) => row.admittedWorkId && row.targetNumberingDiffers,
		).length,
		expectedMatchTop1: rows.filter(
			(row) =>
				row.expectedDecision === "match" &&
				row.candidateIds[0] === row.expectedWorkId,
		).length,
	};
	return {
		corpusVersion: corpus.version,
		productionNumberingVersion: production.version,
		productionNumberingBasis: production.basis,
		matcherVersion: identificationPolicy.matcherVersion,
		candidateSource:
			"All 20 frozen AniList projections; no live search or answer-based filtering.",
		summary,
		groups: {
			base: groupSummary(rows.filter((row) => !row.id.includes(":"))),
			scenario: groupSummary(rows.filter((row) => row.id.includes(":"))),
		},
		rows,
	};
}
