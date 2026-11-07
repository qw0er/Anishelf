import { readFile } from "node:fs/promises";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { AnitomyIdentificationParser } from "../../src/modules/anime/identification/infrastructure/parser.js";
import { AnimeReleaseAssessment } from "../../src/modules/anime/release-assessment/application.js";
import { releaseAttributes } from "../../src/modules/anime/release-assessment/attributes.js";
import type { ReleaseAssessmentApi } from "../../src/modules/anime/release-assessment/public.js";
import { candidateSchema } from "./anime-identification-evidence.js";
import { fixtureIdentities } from "./metadata-identities.js";

const text = Type.String({ minLength: 1 });
const nullable = Type.Union([text, Type.Null()]);
const strings = Type.Array(text, { uniqueItems: true });
const attributeSchema = Type.Object(
	{
		subtitleLanguages: Type.Optional(strings),
		subtitleFormats: Type.Optional(strings),
		resolutions: Type.Optional(
			Type.Array(Type.Integer({ minimum: 1 }), { uniqueItems: true }),
		),
		videoCodecs: Type.Optional(strings),
		sources: Type.Optional(strings),
		releaseGroups: Type.Optional(strings),
		revision: Type.Optional(Type.Integer({ minimum: 1 })),
	},
	{ additionalProperties: false },
);
const schema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	sourceCorpusVersion: text,
	works: Type.Array(Type.Object({ workId: text, candidate: candidateSchema })),
	cases: Type.Array(
		Type.Object({
			id: text,
			kind: Type.Union([Type.Literal("authentic"), Type.Literal("synthetic")]),
			title: text,
			targetId: nullable,
			provenance: Type.Object({
				url: nullable,
				site: text,
				sourceId: nullable,
				note: text,
			}),
			review: text,
			expected: Type.Object(
				{
					attributes: attributeSchema,
					eligible: Type.Optional(Type.Boolean()),
					episode: Type.Optional(
						Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
					),
				},
				{ additionalProperties: false },
			),
		}),
		{ minItems: 1 },
	),
});
type Corpus = Static<typeof schema>;
const attributeFields = [
	"subtitleLanguages",
	"subtitleFormats",
	"resolutions",
	"videoCodecs",
	"sources",
	"releaseGroups",
	"revision",
] as const;
export function validateReleaseCorpus(value: unknown): Corpus {
	if (!Check(schema, value)) throw new Error("Invalid release corpus.");
	if (
		new Set(value.cases.map((entry) => entry.id)).size !== value.cases.length ||
		new Set(value.works.map((work) => work.workId)).size !== value.works.length
	)
		throw new Error("Duplicate release fixture identity.");
	for (const entry of value.cases) {
		if (
			!Object.keys(entry.expected.attributes).length &&
			entry.expected.eligible === undefined &&
			entry.expected.episode === undefined
		)
			throw new Error("Missing release expectations.");
		if (
			entry.targetId !== null &&
			!value.works.some((work) => work.workId === entry.targetId)
		)
			throw new Error("Missing release target.");
		if (
			entry.targetId === null &&
			(entry.expected.eligible !== undefined ||
				entry.expected.episode !== undefined)
		)
			throw new Error("Assessment labels require a known target.");
		if (
			entry.kind === "authentic" &&
			(!entry.provenance.url?.startsWith("https://") ||
				!entry.provenance.sourceId)
		)
			throw new Error("Missing publication provenance.");
	}
	return value;
}
export async function loadReleaseCorpus(): Promise<Corpus> {
	return validateReleaseCorpus(
		JSON.parse(
			await readFile(
				new URL("../fixtures/anime-releases/corpus.json", import.meta.url),
				"utf8",
			),
		),
	);
}
const normalize = (value: unknown) =>
	Array.isArray(value)
		? [
				...new Set(
					value.map((item) =>
						typeof item === "string"
							? item.normalize("NFKC").trim().toLowerCase()
							: item,
					),
				),
			].sort()
		: value;
export function evaluateReleaseCorpus(
	corpus: Corpus,
	assess?: ReleaseAssessmentApi["assessReleaseTitle"],
) {
	validateReleaseCorpus(corpus);
	const parser = new AnitomyIdentificationParser();
	const assessor = new AnimeReleaseAssessment(
		parser,
		{
			get: async () => {
				throw new Error("Offline release test must not request metadata.");
			},
		},
		undefined,
		fixtureIdentities(),
	);
	const run = assess ?? assessor.assessReleaseTitle.bind(assessor);
	const rows = corpus.cases.map((entry) => {
		let error: string | null = null;
		let actual: ReturnType<ReleaseAssessmentApi["assessReleaseTitle"]> | null =
			null;
		let attributes: ReturnType<typeof releaseAttributes> | undefined;
		try {
			const work = corpus.works.find(
				(work) => work.workId === entry.targetId,
			)?.candidate;
			if (work) {
				actual = run(entry.title, {
					work: structuredClone(work),
					searchTitles: [],
					availableEpisodes: [],
					revision: corpus.version,
				});
				attributes = actual.attributes;
			} else attributes = releaseAttributes(parser.extractRelease(entry.title));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
		const failures: string[] = [];
		for (const field of attributeFields)
			if (
				entry.expected.attributes[field] !== undefined &&
				JSON.stringify(normalize(entry.expected.attributes[field])) !==
					JSON.stringify(normalize(attributes?.[field]))
			)
				failures.push(`attributes.${field}`);
		for (const field of ["eligible", "episode"] as const)
			if (
				entry.expected[field] !== undefined &&
				actual?.[field] !== entry.expected[field]
			)
				failures.push(field);
		return {
			id: entry.id,
			kind: entry.kind,
			title: entry.title,
			targetId: entry.targetId,
			expected: entry.expected,
			actual: actual ?? { attributes },
			failures,
			error,
			passed: !error && !failures.length,
		};
	});
	const count = (group: typeof rows) => ({
		total: group.length,
		passed: group.filter((row) => row.passed).length,
		failed: group.filter((row) => !row.passed).length,
		runtimeErrors: group.filter((row) => row.error).length,
	});
	return {
		event: "anime_releases.evaluated",
		version: corpus.version,
		scope:
			"Production release-title assessment and declared attributes; known subscription targets, no RSS fetching, source selection, downloader or media inspection.",
		summary: count(rows),
		groups: Object.fromEntries(
			["authentic", "synthetic"].map((kind) => [
				kind,
				count(rows.filter((row) => row.kind === kind)),
			]),
		),
		fields: Object.fromEntries(
			[
				...attributeFields.map((field) => `attributes.${field}`),
				"eligible",
				"episode",
			].map((field) => {
				const labelled = rows.filter((row) =>
					field.startsWith("attributes.")
						? field.slice(11) in row.expected.attributes
						: field in row.expected,
				);
				return [
					field,
					{
						total: labelled.length,
						correct: labelled.filter(
							(row) => !row.error && !row.failures.includes(field),
						).length,
					},
				];
			}),
		),
		rows,
	};
}
