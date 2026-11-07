import { readFile } from "node:fs/promises";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { identificationSearchQueries } from "../../src/modules/anime/identification/domain/search-queries.js";

const text = Type.String({ minLength: 1 });
const strings = Type.Array(text);
const positive = Type.Integer({ minimum: 1 });
const schema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	provider: Type.Literal("anilist"),
	endpoint: text,
	requestQuery: text,
	cases: Type.Array(
		Type.Object({
			id: text,
			input: Type.Object({ titles: strings, seasons: strings, parts: strings }),
			expectedQueries: strings,
			expectedId: Type.Union([positive, Type.Null()]),
			expectedEmpty: Type.Boolean(),
			labelSource: Type.Union([text, Type.Null()]),
			rationale: text,
		}),
		{ minItems: 1 },
	),
	records: Type.Array(
		Type.Object({
			query: text,
			page: positive,
			perPage: positive,
			fetchedAt: text,
			responseSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
			response: Type.Object({
				pageInfo: Type.Object({
					currentPage: positive,
					perPage: positive,
					hasNextPage: Type.Boolean(),
					total: Type.Integer({ minimum: 0 }),
				}),
				media: Type.Array(
					Type.Object({
						id: positive,
						title: Type.Object({
							native: Type.Union([Type.String(), Type.Null()]),
							romaji: Type.Union([Type.String(), Type.Null()]),
							english: Type.Union([Type.String(), Type.Null()]),
						}),
					}),
				),
			}),
		}),
		{ minItems: 1 },
	),
});
type Corpus = Static<typeof schema>;
const key = (query: string, page: number, perPage: number) =>
	JSON.stringify([query, page, perPage]);
export function validateRetrievalCorpus(value: unknown): Corpus {
	if (!Check(schema, value)) throw new Error("Invalid retrieval corpus.");
	if (new Set(value.cases.map((entry) => entry.id)).size !== value.cases.length)
		throw new Error("Duplicate retrieval case.");
	if (
		new Set(
			value.records.map((record) =>
				key(record.query, record.page, record.perPage),
			),
		).size !== value.records.length
	)
		throw new Error("Duplicate replay request.");
	for (const record of value.records) {
		if (
			record.page !== record.response.pageInfo.currentPage ||
			record.perPage !== record.response.pageInfo.perPage ||
			record.response.media.length > record.perPage ||
			new Set(record.response.media.map((item) => item.id)).size !==
				record.response.media.length
		)
			throw new Error("Invalid replay page.");
	}
	for (const entry of value.cases) {
		if (
			(entry.expectedId === null) !== entry.expectedEmpty ||
			(entry.expectedId !== null &&
				entry.labelSource !== `https://anilist.co/anime/${entry.expectedId}`)
		)
			throw new Error("Invalid independent retrieval label.");
		for (const query of entry.expectedQueries)
			if (
				!value.records.some(
					(record) =>
						key(record.query, record.page, record.perPage) ===
						key(query, 1, 10),
				)
			)
				throw new Error("Missing expected replay request.");
	}
	return value;
}
export async function loadRetrievalCorpus(): Promise<Corpus> {
	return validateRetrievalCorpus(
		JSON.parse(
			await readFile(
				new URL("../fixtures/anime-retrieval/corpus.json", import.meta.url),
				"utf8",
			),
		),
	);
}
export function evaluateRetrievalCorpus(
	corpus: Corpus,
	generate = identificationSearchQueries,
) {
	validateRetrievalCorpus(corpus);
	const recordings = new Map(
		corpus.records.map((record) => [
			key(record.query, record.page, record.perPage),
			record,
		]),
	);
	const rows = corpus.cases.map((entry) => {
		const queries = generate(structuredClone(entry.input));
		const candidates = new Set<number>();
		const missing: string[] = [];
		for (const query of queries) {
			const record = recordings.get(key(query, 1, 10));
			if (!record) {
				missing.push(query);
				continue;
			}
			for (const item of record.response.media) candidates.add(item.id);
		}
		const queryContract =
			JSON.stringify(queries) === JSON.stringify(entry.expectedQueries);
		const recalled =
			entry.expectedId !== null && candidates.has(entry.expectedId);
		return {
			id: entry.id,
			queries,
			missing,
			candidateIds: [...candidates],
			expectedId: entry.expectedId,
			queryContract,
			recalled,
			passed:
				!missing.length &&
				queryContract &&
				(entry.expectedEmpty ? candidates.size === 0 : recalled),
		};
	});
	return {
		event: "anime_retrieval.evaluated",
		version: corpus.version,
		scope:
			"Small first-page AniList ID replay using production query generation; not HTTP adapter, pagination, ranking or live recall coverage.",
		total: rows.length,
		passed: rows.filter((row) => row.passed).length,
		failed: rows.filter((row) => !row.passed).length,
		positives: rows.filter((row) => row.expectedId !== null).length,
		recalled: rows.filter((row) => row.recalled).length,
		missingRequests: rows.reduce((sum, row) => sum + row.missing.length, 0),
		rows,
	};
}
