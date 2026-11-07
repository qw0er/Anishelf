import { readFile } from "node:fs/promises";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { identificationDefaults } from "../../src/modules/anime/identification/defaults.js";
import { rankCandidates } from "../../src/modules/anime/identification/domain/matching.js";
import type {
	ExtractionEvidence,
	WorkCandidate,
} from "../../src/modules/anime/identification/domain/model.js";

import {
	candidateSchema,
	evidenceSchema,
} from "./anime-identification-evidence.js";

const text = Type.String({ minLength: 1 });
const nullableText = Type.Union([text, Type.Null()]);
const schema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	extractedFrom: Type.Object({ identification: text, reported: text }),
	evidenceOrigin: Type.Object({
		kind: Type.Literal("parser-snapshot"),
		parserVersion: text,
		note: text,
	}),
	pools: Type.Array(
		Type.Object({
			id: text,
			provenance: text,
			works: Type.Array(
				Type.Object({ workId: text, candidate: candidateSchema }),
				{ minItems: 1 },
			),
		}),
		{ minItems: 1 },
	),
	cases: Type.Array(
		Type.Object({
			id: text,
			group: Type.Union([Type.Literal("base"), Type.Literal("reported")]),
			poolId: text,
			tags: Type.Array(text, { minItems: 1 }),
			provenance: Type.Object({
				kind: text,
				sourceId: nullableText,
				note: text,
				url: Type.Optional(text),
			}),
			evidence: evidenceSchema,
			expected: Type.Object(
				{ workId: nullableText },
				{ additionalProperties: false },
			),
			sourceDecision: Type.Union([
				Type.Literal("match"),
				Type.Literal("review"),
				Type.Literal("ignore"),
				Type.Literal("unidentified"),
			]),
			rationale: text,
		}),
		{ minItems: 1 },
	),
});
type RankingCorpus = Static<typeof schema>;
const manifestSchema = Type.Intersect([
	Type.Omit(schema, ["cases"]),
	Type.Object({
		caseFiles: Type.Array(
			Type.String({ pattern: "^cases-[a-z0-9-]+\\.json$" }),
			{ minItems: 1 },
		),
	}),
]);

function unique(values: string[], label: string) {
	if (new Set(values).size !== values.length)
		throw new Error(`Duplicate ranking ${label}.`);
}

export function validateRankingCorpus(value: unknown): RankingCorpus {
	if (!Check(schema, value)) throw new Error("Invalid ranking corpus schema.");
	unique(
		value.pools.map((pool) => pool.id),
		"pool ID",
	);
	unique(
		value.cases.map((entry) => entry.id),
		"case ID",
	);
	for (const pool of value.pools) {
		unique(
			pool.works.map((work) => work.workId),
			"work ID",
		);
		unique(
			pool.works.map((work) => work.candidate.reference.id),
			"candidate reference",
		);
	}
	for (const entry of value.cases) {
		const pool = value.pools.find((pool) => pool.id === entry.poolId);
		if (!pool) throw new Error(`Unknown ranking pool: ${entry.id}`);
		if (
			entry.expected.workId !== null &&
			!pool.works.some((work) => work.workId === entry.expected.workId)
		)
			throw new Error(`Expected work absent from ranking pool: ${entry.id}`);
		if (
			`${entry.evidence.parser}@${entry.evidence.parserVersion}:${entry.evidence.normalizationVersion}` !==
			value.evidenceOrigin.parserVersion
		)
			throw new Error(`Inconsistent frozen parser version: ${entry.id}`);
	}
	return value;
}

/** Only this standalone fixture directory is read; extraction and retrieval never run. */
export async function loadRankingCorpus(): Promise<RankingCorpus> {
	const root = new URL("../fixtures/anime-ranking/", import.meta.url);
	const manifest: unknown = JSON.parse(
		await readFile(new URL("corpus.json", root), "utf8"),
	);
	if (!Check(manifestSchema, manifest))
		throw new Error("Invalid ranking manifest schema.");
	unique(manifest.caseFiles, "case file");
	const cases = [];
	for (const file of manifest.caseFiles) {
		const entries: unknown = JSON.parse(
			await readFile(new URL(file, root), "utf8"),
		);
		if (!Check(schema.properties.cases, entries))
			throw new Error(`Invalid ranking cases: ${file}`);
		cases.push(...entries);
	}
	return validateRankingCorpus({ ...manifest, cases });
}

export function evaluateRankingCorpus(
	corpus: RankingCorpus,
	ranker = {
		version: identificationDefaults.matcherVersion as string,
		rank: rankCandidates,
	},
) {
	validateRankingCorpus(corpus);
	const pools = new Map(corpus.pools.map((pool) => [pool.id, pool]));
	const rows = corpus.cases.map((entry) => {
		const pool = pools.get(entry.poolId);
		if (!pool) throw new Error(`Unknown ranking pool: ${entry.poolId}`);
		const ids = new Map(
			pool.works.map((work) => [work.candidate.reference.id, work.workId]),
		);
		let error: string | null = null;
		let ranked: ReturnType<typeof rankCandidates> = [];
		try {
			// Labels never enter the ranker or control candidate membership/order.
			const evidence: ExtractionEvidence = structuredClone(entry.evidence);
			const works: WorkCandidate[] = structuredClone(
				pool.works.map((work) => work.candidate),
			);
			ranked = ranker.rank(evidence, works);
			unique(
				ranked.map((item) => item.work.reference.id),
				"output reference",
			);
			if (
				ranked.some(
					(item) =>
						!ids.has(item.work.reference.id) || !Number.isFinite(item.score),
				)
			)
				throw new Error("Invalid ranking output reference or score.");
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			ranked = [];
		}
		const candidates = ranked.map((item) => ({
			workId: ids.get(item.work.reference.id) ?? null,
			reference: item.work.reference,
			score: item.score,
			reasons: item.reasons,
			conflicts: item.conflicts,
			identityConflicts: item.identityConflicts ?? [],
			identityUnresolved: item.identityUnresolved ?? [],
			assumptions: item.assumptions ?? [],
		}));
		const expectedId = entry.expected.workId;
		const index =
			expectedId === null
				? -1
				: candidates.findIndex((item) => item.workId === expectedId);
		const rank = index < 0 ? null : index + 1;
		return {
			id: entry.id,
			group: entry.group,
			poolId: entry.poolId,
			tags: entry.tags,
			relativePath: entry.evidence.relativePath,
			expectedWorkId: expectedId,
			sourceDecision: entry.sourceDecision,
			status: error
				? "failed"
				: expectedId === null
					? "unscored"
					: rank === 1
						? "passed"
						: "failed",
			rank,
			top1: expectedId !== null && rank === 1,
			top5: expectedId !== null && rank !== null && rank <= 5,
			reciprocalRank: rank === null ? 0 : 1 / rank,
			topScoreTied:
				candidates.length > 1 && candidates[0]?.score === candidates[1]?.score,
			error,
			candidates,
		};
	});
	const summarize = (group: typeof rows) => {
		const labelled = group.filter((row) => row.expectedWorkId !== null);
		return {
			total: group.length,
			evaluated: labelled.length,
			passed: group.filter((row) => row.status === "passed").length,
			failed: group.filter((row) => row.status === "failed").length,
			unscored: group.filter((row) => row.status === "unscored").length,
			runtimeErrors: group.filter((row) => row.error !== null).length,
			top1: labelled.filter((row) => row.top1).length,
			top5: labelled.filter((row) => row.top5).length,
			missingFromRanked: labelled.filter((row) => row.rank === null).length,
			meanReciprocalRank: labelled.length
				? labelled.reduce((sum, row) => sum + row.reciprocalRank, 0) /
					labelled.length
				: null,
			topScoreTies: labelled.filter((row) => row.topScoreTied).length,
		};
	};
	return {
		event: "anime_ranking.evaluated",
		corpusVersion: corpus.version,
		matcherVersion: ranker.version,
		titleNormalizationVersion: identificationDefaults.normalizationVersion,
		evidenceOrigin: corpus.evidenceOrigin,
		scope:
			"Production candidate ranking over frozen parser evidence and complete fixed pools; no filename extraction, retrieval, episode mapping or admission. Null identity labels are unscored, not rejection labels.",
		summary: summarize(rows),
		groups: Object.fromEntries(
			["base", "reported"].map((group) => [
				group,
				summarize(rows.filter((row) => row.group === group)),
			]),
		),
		byTag: Object.fromEntries(
			[...new Set(rows.flatMap((row) => row.tags))]
				.sort()
				.map((tag) => [
					tag,
					summarize(rows.filter((row) => row.tags.includes(tag))),
				]),
		),
		rows,
	};
}
