import { readFile } from "node:fs/promises";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { ExtractionEvidence } from "../../src/modules/anime/identification/domain/model.js";
import { AnitomyIdentificationParser } from "../../src/modules/anime/identification/infrastructure/parser.js";
import { evidenceSchema } from "./anime-identification-evidence.js";
import {
	parsingFields as fields,
	parsedFields,
	parsingExpectedSchema,
	parsingFieldMatches,
	titleChecks,
	validateParsingLabels,
} from "./anime-parsing-labels.js";

const text = Type.String({ minLength: 1 });
const expectedSchema = parsingExpectedSchema;
const schema = Type.Object({
	schemaVersion: Type.Literal(2),
	version: text,
	extractedFrom: Type.Object({ identification: text, reported: text }),
	sources: Type.Array(
		Type.Object({
			id: text,
			url: text,
			retrievedAt: text,
			responseSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
			observedPath: text,
			note: text,
		}),
	),
	cases: Type.Array(
		Type.Object({
			id: text,
			group: Type.Union([
				Type.Literal("legacy"),
				Type.Literal("reviewed-existing"),
				Type.Literal("web"),
				Type.Literal("synthetic-context"),
			]),
			review: Type.Optional(
				Type.Object({
					reviewedAt: text,
					method: Type.Literal("literal-source-review"),
					note: text,
				}),
			),
			derivedFrom: Type.Optional(text),
			inheritedExpected: Type.Optional(expectedSchema),
			relativePath: text,
			batch: Type.Union([text, Type.Null()]),
			tags: Type.Array(text, { minItems: 1 }),
			provenance: Type.Object({
				kind: text,
				sourceId: Type.Union([text, Type.Null()]),
				note: text,
				url: Type.Optional(text),
			}),
			expected: expectedSchema,
			unscored: Type.Object(
				{ contentType: Type.Optional(Type.Literal("movie")) },
				{ additionalProperties: false },
			),
			rationale: text,
		}),
		{ minItems: 1 },
	),
});
type ParsingCorpus = Static<typeof schema>;
/** A standalone fixture: no provider snapshots, matching corpus or application setup. */
export async function loadParsingCorpus(): Promise<ParsingCorpus> {
	return validateParsingCorpus(
		JSON.parse(
			await readFile(
				new URL("../fixtures/anime-parsing/corpus.json", import.meta.url),
				"utf8",
			),
		),
	);
}

export function validateParsingCorpus(value: unknown): ParsingCorpus {
	if (!Check(schema, value)) throw new Error("Invalid parsing corpus schema.");
	const ids = new Set<string>();
	const sources = new Map(value.sources.map((source) => [source.id, source]));
	if (sources.size !== value.sources.length)
		throw new Error("Duplicate parsing source ID.");
	for (const entry of value.cases) {
		if (ids.has(entry.id))
			throw new Error(`Duplicate parsing case: ${entry.id}`);
		ids.add(entry.id);
		validateParsingLabels(entry.expected);
		if (entry.group !== "legacy" && !entry.review)
			throw new Error(`Missing parsing review: ${entry.id}`);
		if (entry.group === "web") {
			const source = sources.get(entry.provenance.sourceId ?? "");
			if (
				!source ||
				source.observedPath !== entry.relativePath ||
				source.url !== entry.provenance.url
			)
				throw new Error(`Unverified web path: ${entry.id}`);
		}
		if (
			entry.derivedFrom &&
			(entry.derivedFrom === entry.id ||
				!value.cases.some((source) => source.id === entry.derivedFrom))
		)
			throw new Error(`Missing derived parsing source: ${entry.id}`);
		if (
			entry.relativePath.startsWith("/") ||
			entry.relativePath.includes("\\") ||
			entry.relativePath.includes("\0") ||
			entry.relativePath
				.split("/")
				.some((part) => !part || part === "." || part === "..")
		)
			throw new Error(`Invalid parsing path: ${entry.id}`);
	}
	return value;
}

export function summarizeParsingCorpus(corpus: ParsingCorpus) {
	return {
		version: corpus.version,
		extractedFrom: corpus.extractedFrom,
		total: corpus.cases.length,
		labelled: corpus.cases.filter(
			(entry) => Object.keys(entry.expected).length > 0,
		).length,
		sources: corpus.sources.length,
		groups: Object.fromEntries(
			["legacy", "reviewed-existing", "web", "synthetic-context"].map(
				(group) => [
					group,
					corpus.cases.filter((entry) => entry.group === group).length,
				],
			),
		),
		fields: Object.fromEntries(
			fields.map((field) => [
				field,
				corpus.cases.filter((entry) => field in entry.expected).length,
			]),
		),
		arrayLabels: Object.fromEntries(
			(
				[
					"rawEpisodes",
					"selectedEpisodes",
					"seasons",
					"parts",
					"years",
				] as const
			).map((field) => {
				const values = corpus.cases.flatMap((entry) =>
					entry.expected[field] === undefined ? [] : [entry.expected[field]],
				);
				return [
					field,
					{
						nonEmpty: values.filter((value) => value.length > 0).length,
						empty: values.filter((value) => value.length === 0).length,
					},
				];
			}),
		),
	};
}

export function evaluateParsingCorpus(
	corpus: ParsingCorpus,
	parser: Pick<
		AnitomyIdentificationParser,
		"version" | "extract"
	> = new AnitomyIdentificationParser(),
) {
	validateParsingCorpus(corpus);
	const groups = new Map<string, ParsingCorpus["cases"]>();
	for (const entry of corpus.cases) {
		const key = JSON.stringify(
			entry.batch === null
				? ["case", entry.id]
				: [
						"batch",
						entry.batch,
						entry.relativePath.slice(
							0,
							entry.relativePath.lastIndexOf("/") + 1,
						),
					],
		);
		const group = groups.get(key) ?? [];
		group.push(entry);
		groups.set(key, group);
	}
	const outputs = new Map<string, ExtractionEvidence>();
	const errors = new Map<string, string>();
	for (const entries of groups.values()) {
		try {
			const evidence = parser.extract(
				entries.map((entry) => entry.relativePath),
			);
			if (evidence.length !== entries.length)
				throw new Error("Parser returned a different number of results.");
			for (const [index, entry] of entries.entries()) {
				const result = evidence[index];
				if (
					!result ||
					!Check(evidenceSchema, result) ||
					result.relativePath !== entry.relativePath
				)
					throw new Error("Parser returned mismatched paths.");
				outputs.set(entry.id, result);
			}
		} catch (error) {
			for (const entry of entries)
				errors.set(
					entry.id,
					error instanceof Error ? error.message : String(error),
				);
		}
	}
	const rows = corpus.cases.map((entry) => {
		const evidence = outputs.get(entry.id);
		const actual =
			evidence && !errors.has(entry.id) ? parsedFields(evidence) : null;
		const labelled = fields.filter(
			(field) => entry.expected[field] !== undefined,
		);
		const failures = labelled.filter(
			(field) => !parsingFieldMatches(field, entry.expected, actual),
		);
		const error = errors.get(entry.id) ?? null;
		return {
			...entry,
			status:
				error || failures.length
					? "failed"
					: labelled.length
						? "passed"
						: "unscored",
			failures,
			error,
			actual,
			checks: titleChecks(entry.expected, actual),
			// Retain unlabelled evidence for inspection without counting it as correct.
			evidence: evidence ?? null,
		};
	});
	const count = (group: typeof rows) => ({
		total: group.length,
		evaluated: group.filter((row) => Object.keys(row.expected).length > 0)
			.length,
		passed: group.filter((row) => row.status === "passed").length,
		failed: group.filter((row) => row.status === "failed").length,
		unscored: group.filter((row) => row.status === "unscored").length,
		runtimeErrors: group.filter((row) => row.error !== null).length,
	});
	return {
		event: "anime_parsing.evaluated",
		corpusVersion: corpus.version,
		parserVersion: parser.version,
		scope:
			"Offline title/source, ordinal/year, raw/selected numbering, content and revision extraction; no metadata, matching, numbering conversion or admission.",
		summary: count(rows),
		coverage: summarizeParsingCorpus(corpus),
		fields: Object.fromEntries(
			fields.map((field) => {
				const labelled = rows.filter(
					(row) => row.expected[field] !== undefined,
				);
				return [
					field,
					{
						total: labelled.length,
						correct: labelled.filter(
							(row) => !row.error && !row.failures.includes(field),
						).length,
						unlabelled: rows.length - labelled.length,
					},
				];
			}),
		),
		byGroup: Object.fromEntries(
			["legacy", "reviewed-existing", "web", "synthetic-context"].map(
				(group) => [group, count(rows.filter((row) => row.group === group))],
			),
		),
		checks: Object.fromEntries(
			["titles", "sources"].map((key) => [
				key,
				Object.fromEntries(
					["required", "matched", "forbidden", "violations"].map((metric) => [
						metric,
						rows.reduce(
							(sum, row) =>
								sum +
								row.checks[key as "titles" | "sources"][
									metric as "required" | "matched" | "forbidden" | "violations"
								],
							0,
						),
					]),
				),
			]),
		),
		byTag: Object.fromEntries(
			[...new Set(rows.flatMap((row) => row.tags))]
				.sort()
				.map((tag) => [
					tag,
					count(rows.filter((row) => row.tags.includes(tag))),
				]),
		),
		rows,
	};
}
