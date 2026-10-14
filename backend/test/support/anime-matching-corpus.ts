import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { automaticProposal } from "../../src/modules/anime/anime-catalog/domain/admission.js";
import type { ReviewRecord } from "../../src/modules/anime/anime-catalog/domain/model.js";
import { catalogPolicy } from "../../src/modules/anime/anime-catalog/policy.js";
import { IdentificationApplication } from "../../src/modules/anime/identification/application/identification.js";
import { matchingTitle } from "../../src/modules/anime/identification/domain/title-evidence.js";
import { AnitomyIdentificationParser } from "../../src/modules/anime/identification/infrastructure/parser.js";
import { identificationPolicy } from "../../src/modules/anime/identification/policy.js";
import type {
	IdentificationResult,
	WorkCandidate,
} from "../../src/modules/anime/identification/public.js";
import { type AnimeCase, corpusDirectory, loadCorpus } from "./anime-corpus.js";

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
						provider: "anilist",
						mediaType: "anime" as const,
						id: String(anilist.id),
					},
					snapshotId: work.snapshot,
					titles: [
						...Object.values(anilist.titles),
						...anilist.synonyms,
					].filter((title): title is string => Boolean(title)),
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
		canonicalRoot: result.source.canonicalRoot,
		sourceVersion: result.source.sourceVersion,
		available: true,
		revision: 1,
		decision: "pending",
		reason: null,
	};
}
export async function evaluateMatchingCorpus() {
	const { corpus, candidates } = await matchingCorpusCandidates();
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
				canonicalRoot: "/corpus",
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
			const best = result.proposals[0];
			const workId = proposal
				? (ids.get(proposal.candidate.work.reference.id) ?? null)
				: null;
			const expected = item.entry.expected;
			const expectedMovie =
				candidates.find((work) => work.workId === expected.workId)?.candidate
					.format === "MOVIE";
			const candidateIds = result.proposals.map(
				({ candidate }) => ids.get(candidate.work.reference.id) ?? null,
			);
			const unsafe = Boolean(
				proposal &&
					(expected.decision !== "match" || workId !== expected.workId),
			);
			// Bangumi sort values are not production AniList season-local numbering.
			// Compare only unchanged, positive integer release numbers, or whole movies.
			const comparable =
				expected.decision === "match" &&
				(expectedMovie ||
					Boolean(
						expected.episodes?.length &&
							expected.parsed.rawEpisodes?.length &&
							JSON.stringify(expected.episodes) ===
								JSON.stringify(expected.parsed.rawEpisodes) &&
							expected.episodes.every(
								(number) => Number.isInteger(number) && number > 0,
							),
					));
			const expectedTargets = expectedMovie
				? ["whole"]
				: expected.episodes?.map(String);
			const actualTargets =
				proposal?.mapping.targets.map((target) => target.number) ?? [];
			const episodeMismatch = Boolean(
				proposal &&
					comparable &&
					JSON.stringify(expectedTargets) !== JSON.stringify(actualTargets),
			);
			const blockers = best
				? [...best.candidate.conflicts, ...best.mapping.unresolved]
				: ["No candidate."];
			if (best && best.candidate.score < catalogPolicy.automaticMinimumScore)
				blockers.push("Ranking score below admission minimum.");
			const next = result.proposals[1];
			if (
				best &&
				next &&
				best.candidate.score - next.candidate.score <
					catalogPolicy.automaticMinimumMargin
			)
				blockers.push("Insufficient ranking margin.");
			if (
				best &&
				!result.evidence.titles.some((title) =>
					best.candidate.work.titles.some((alias) =>
						matchingTitle(title, alias, result.evidence.seasons),
					),
				)
			)
				blockers.push("No exact title match for admission.");
			rows.push({
				id: item.id,
				path: item.path,
				tags: item.entry.tags,
				expectedDecision: expected.decision,
				expectedWorkId: expected.workId,
				expectedEpisodes: expected.episodes,
				rawEpisodes: result.evidence.rawEpisodes,
				candidateIds,
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
				candidates: result.proposals.map(({ candidate, mapping }) => ({
					workId: ids.get(candidate.work.reference.id),
					score: candidate.score,
					reasons: candidate.reasons,
					conflicts: candidate.conflicts,
					unresolved: mapping.unresolved,
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
		expectedMatchTop1: rows.filter(
			(row) =>
				row.expectedDecision === "match" &&
				row.candidateIds[0] === row.expectedWorkId,
		).length,
	};
	return {
		corpusVersion: corpus.version,
		matcherVersion: identificationPolicy.matcherVersion,
		candidateSource:
			"All 20 frozen AniList projections; no live search or answer-based filtering.",
		summary,
		rows,
	};
}
