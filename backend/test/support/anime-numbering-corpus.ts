import { readFile } from "node:fs/promises";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { identificationDefaults } from "../../src/modules/anime/identification/defaults.js";
import { proposeMapping } from "../../src/modules/anime/identification/domain/mapping.js";
import type {
	IdentificationResult,
	MappingProposal,
	RankedCandidate,
} from "../../src/modules/anime/identification/domain/model.js";
import { applyNumberingContext } from "../../src/modules/anime/identification/domain/numbering-context.js";
import {
	candidateSchema,
	evidenceSchema,
} from "./anime-identification-evidence.js";

const text = Type.String({ minLength: 1 });
const nullableText = Type.Union([text, Type.Null()]);
const strings = Type.Array(Type.String());
const targets = Type.Array(
	Type.Object({
		kind: Type.Union([
			Type.Literal("regular"),
			Type.Literal("special"),
			Type.Literal("movie"),
		]),
		number: text,
	}),
);
const rankingSchema = Type.Object({
	score: Type.Number(),
	reasons: strings,
	conflicts: strings,
	identityConflicts: Type.Optional(strings),
	identityUnresolved: Type.Optional(strings),
	assumptions: Type.Optional(strings),
	matcherVersion: text,
});
const mappingSchema = Type.Object({
	targets,
	reasons: strings,
	unresolved: strings,
	numbering: Type.Optional(
		Type.Object({
			source: Type.Literal("directory-anchors"),
			offset: Type.Integer(),
			anchors: Type.Array(Type.Object({ fileId: text, sourceVersion: text })),
		}),
	),
});
const labelEvidenceSchema = Type.Object({
	caseId: text,
	workId: text,
	snapshot: text,
	providerId: text,
	basis: Type.Union([
		Type.Literal("explicit-season-local-filename"),
		Type.Literal("curated-local-numbering"),
	]),
	expectedSorts: Type.Array(Type.Number()),
	targets: Type.Array(text, { minItems: 1 }),
});
const schema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	extractedFrom: Type.Object({
		identification: text,
		reported: text,
		productionNumbering: text,
	}),
	evidenceOrigin: Type.Object({
		kind: Type.Literal("parser-snapshot"),
		parserVersion: text,
		note: text,
	}),
	works: Type.Array(Type.Object({ workId: text, candidate: candidateSchema }), {
		minItems: 1,
	}),
	cases: Type.Array(
		Type.Object({
			id: text,
			group: Type.Union([
				Type.Literal("base"),
				Type.Literal("reported"),
				Type.Literal("scenario"),
				Type.Literal("rules"),
			]),
			batch: nullableText,
			workId: nullableText,
			evidence: evidenceSchema,
			rankingEvidence: Type.Union([rankingSchema, Type.Null()]),
			tags: Type.Array(text, { minItems: 1 }),
			provenance: Type.Object({
				kind: text,
				sourceId: nullableText,
				note: text,
				url: Type.Optional(text),
			}),
			rationale: text,
			expected: Type.Union([
				Type.Object(
					{
						targets,
						resolved: Type.Boolean(),
						offset: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
					},
					{ additionalProperties: false },
				),
				Type.Null(),
			]),
			basis: text,
			labelEvidence: Type.Optional(labelEvidenceSchema),
			numberingEvidence: Type.Optional(
				Type.Object({
					snapshot: text,
					providerSorts: Type.Array(Type.Number()),
					providerLocalNumbers: Type.Array(
						Type.Union([Type.Number(), Type.Null()]),
					),
					episodeCount: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
				}),
			),
		}),
		{ minItems: 1 },
	),
});
type NumberingCorpus = Static<typeof schema>;
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
		throw new Error(`Duplicate numbering ${label}.`);
}
function equal(a: unknown, b: unknown) {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function validateNumberingCorpus(value: unknown): NumberingCorpus {
	if (!Check(schema, value))
		throw new Error("Invalid numbering corpus schema.");
	unique(
		value.cases.map((entry) => entry.id),
		"case ID",
	);
	unique(
		value.works.map((work) => work.workId),
		"work ID",
	);
	const works = new Map(
		value.works.map((work) => [work.workId, work.candidate]),
	);
	for (const entry of value.cases) {
		const work = entry.workId === null ? null : works.get(entry.workId);
		if (entry.workId !== null && !work)
			throw new Error(`Unknown selected work: ${entry.id}`);
		if (
			(entry.workId === null) !== (entry.rankingEvidence === null) ||
			(entry.workId === null && entry.expected !== null)
		)
			throw new Error(`Missing selected-work evidence: ${entry.id}`);
		if (
			`${entry.evidence.parser}@${entry.evidence.parserVersion}:${entry.evidence.normalizationVersion}` !==
			value.evidenceOrigin.parserVersion
		)
			throw new Error(`Inconsistent frozen parser version: ${entry.id}`);
		if (entry.labelEvidence) {
			const label = entry.labelEvidence;
			if (
				entry.basis !== "frozen-season-local-label" ||
				label.workId !== entry.workId ||
				label.providerId !== work?.reference.id ||
				label.snapshot !== work.snapshotId ||
				!equal(
					entry.expected?.targets,
					label.targets.map((number) => ({ kind: "regular", number })),
				)
			)
				throw new Error(
					`Inconsistent independent numbering label: ${entry.id}`,
				);
		}
		if (entry.basis === "frozen-season-local-label" && !entry.labelEvidence)
			throw new Error(`Missing independent numbering label: ${entry.id}`);
		if (entry.basis === "unchanged-numbering") {
			const proof = entry.numberingEvidence;
			if (
				!proof ||
				proof.snapshot !== work?.snapshotId ||
				proof.episodeCount !== work.episodeCount ||
				!equal(proof.providerSorts, proof.providerLocalNumbers) ||
				!equal(
					entry.expected?.targets,
					proof.providerLocalNumbers.map((number) => ({
						kind: "regular",
						number: String(number),
					})),
				) ||
				proof.providerLocalNumbers.some(
					(number) =>
						number === null ||
						!Number.isSafeInteger(number) ||
						number < 1 ||
						(work.episodeCount !== null && number > work.episodeCount),
				)
			)
				throw new Error(`Unverified unchanged numbering: ${entry.id}`);
		}
	}
	return value;
}

/** A standalone snapshot; no other corpus, provider, parser or application is loaded. */
export async function loadNumberingCorpus(): Promise<NumberingCorpus> {
	const root = new URL("../fixtures/anime-numbering/", import.meta.url);
	const manifest: unknown = JSON.parse(
		await readFile(new URL("corpus.json", root), "utf8"),
	);
	if (!Check(manifestSchema, manifest))
		throw new Error("Invalid numbering manifest schema.");
	unique(manifest.caseFiles, "case file");
	const cases = [];
	for (const file of manifest.caseFiles) {
		const entries: unknown = JSON.parse(
			await readFile(new URL(file, root), "utf8"),
		);
		if (!Check(schema.properties.cases, entries))
			throw new Error(`Invalid numbering cases: ${file}`);
		cases.push(...entries);
	}
	return validateNumberingCorpus({ ...manifest, cases });
}

export function evaluateNumberingCorpus(
	corpus: NumberingCorpus,
	mapper = { propose: proposeMapping, applyContext: applyNumberingContext },
) {
	validateNumberingCorpus(corpus);
	const works = new Map(
		corpus.works.map((work) => [work.workId, work.candidate]),
	);
	const groups = new Map<string, NumberingCorpus["cases"]>();
	for (const entry of corpus.cases) {
		const key = JSON.stringify(
			entry.batch === null
				? [entry.group, "case", entry.id]
				: [entry.group, "batch", entry.batch],
		);
		const group = groups.get(key) ?? [];
		group.push(entry);
		groups.set(key, group);
	}
	const outputs = new Map<string, MappingProposal>();
	const errors = new Map<string, string>();
	for (const [scopeId, entries] of groups) {
		const results: IdentificationResult[] = [];
		for (const entry of entries) {
			if (entry.workId === null || entry.rankingEvidence === null) continue;
			const work = works.get(entry.workId);
			if (!work) throw new Error(`Unknown selected work: ${entry.id}`);
			try {
				const evidence = structuredClone(entry.evidence);
				const candidate: RankedCandidate = {
					...structuredClone(entry.rankingEvidence),
					work: structuredClone(work),
				};
				const mapping = mapper.propose(evidence, candidate.work);
				if (!Check(mappingSchema, mapping))
					throw new Error("Invalid mapping output.");
				results.push({
					source: {
						scopeId,
						fileId: entry.id,
						relativePath: evidence.relativePath,
						sourceVersion: corpus.version,
					},
					evidence,
					status: "proposed",
					metadataStatus: "searched",
					proposals: [{ candidate, mapping }],
					unresolved: [],
				});
			} catch (error) {
				errors.set(
					entry.id,
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		if (!results.length) continue;
		const sources = results.map((result) => ({ ...result.source }));
		try {
			// Context rules retain their production title/season/one-work validation.
			mapper.applyContext(results);
			if (
				results.length !== sources.length ||
				new Set(results.map((result) => result.source.fileId)).size !==
					sources.length ||
				results.some(
					(result) => !sources.some((source) => equal(source, result.source)),
				)
			)
				throw new Error("Context mapping changed the source identities.");
			for (const result of results) {
				const proposal = result.proposals[0];
				if (
					result.proposals.length !== 1 ||
					!proposal ||
					!Check(mappingSchema, proposal.mapping)
				)
					throw new Error("Missing or invalid context mapping output.");
				if (
					proposal.mapping.numbering?.anchors.some(
						(anchor) =>
							!results.some(
								(result) =>
									result.source.fileId === anchor.fileId &&
									result.source.sourceVersion === anchor.sourceVersion,
							),
					)
				)
					throw new Error("Unknown numbering anchor.");
				outputs.set(result.source.fileId, proposal.mapping);
			}
		} catch (error) {
			for (const source of sources)
				errors.set(
					source.fileId,
					error instanceof Error ? error.message : String(error),
				);
		}
	}
	const rows = corpus.cases.map((entry) => {
		const error = errors.get(entry.id) ?? null;
		const mapping = error ? null : (outputs.get(entry.id) ?? null);
		const actual = mapping
			? {
					targets: mapping.targets,
					resolved:
						mapping.targets.length > 0 && mapping.unresolved.length === 0,
					offset: mapping.numbering?.offset ?? null,
				}
			: null;
		const failures: string[] = [];
		if (entry.expected) {
			if (!equal(entry.expected.targets, actual?.targets))
				failures.push("targets");
			if (entry.expected.resolved !== actual?.resolved)
				failures.push("resolved");
			if (
				entry.expected.offset !== undefined &&
				entry.expected.offset !== actual?.offset
			)
				failures.push("offset");
		}
		return {
			id: entry.id,
			group: entry.group,
			batch: entry.batch,
			tags: entry.tags,
			basis: entry.basis,
			workId: entry.workId,
			relativePath: entry.evidence.relativePath,
			rawEpisodes: entry.evidence.rawEpisodes,
			selectedEpisodes: entry.evidence.selectedEpisodes,
			seasons: entry.evidence.seasons,
			parts: entry.evidence.parts,
			expected: entry.expected,
			actual,
			mapping,
			failures,
			error,
			status:
				error || failures.length
					? "failed"
					: entry.expected
						? "passed"
						: "unscored",
		};
	});
	const summarize = (group: typeof rows) => {
		const labelled = group.filter((row) => row.expected !== null);
		const offset = labelled.filter((row) => row.expected?.offset !== undefined);
		return {
			total: group.length,
			evaluated: labelled.length,
			passed: group.filter((row) => row.status === "passed").length,
			failed: group.filter((row) => row.status === "failed").length,
			unscored: group.filter((row) => row.status === "unscored").length,
			runtimeErrors: group.filter((row) => row.error !== null).length,
			targets: {
				total: labelled.length,
				correct: labelled.filter(
					(row) => !row.error && !row.failures.includes("targets"),
				).length,
			},
			resolution: {
				total: labelled.length,
				correct: labelled.filter(
					(row) => !row.error && !row.failures.includes("resolved"),
				).length,
			},
			offset: {
				total: offset.length,
				correct: offset.filter(
					(row) => !row.error && !row.failures.includes("offset"),
				).length,
			},
		};
	};
	return {
		event: "anime_numbering.evaluated",
		corpusVersion: corpus.version,
		evidenceOrigin: corpus.evidenceOrigin,
		rules: {
			matcherVersion: identificationDefaults.matcherVersion,
			normalizationVersion: identificationDefaults.normalizationVersion,
			maximumRange: identificationDefaults.maximumRange,
			maximumEpisode: identificationDefaults.maximumEpisode,
		},
		scope:
			"Known-work episode mapping and directory-anchor conversion over frozen extraction/ranking evidence; no extraction, retrieval, competing work ranking or Catalog admission. Season/Part identity selection remains outside this stage.",
		summary: summarize(rows),
		groups: Object.fromEntries(
			["base", "reported", "scenario", "rules"].map((group) => [
				group,
				summarize(rows.filter((row) => row.group === group)),
			]),
		),
		byBasis: Object.fromEntries(
			[...new Set(rows.map((row) => row.basis))]
				.sort()
				.map((basis) => [
					basis,
					summarize(rows.filter((row) => row.basis === basis)),
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
