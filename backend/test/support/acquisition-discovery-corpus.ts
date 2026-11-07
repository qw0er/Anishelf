import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import pino from "pino";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { MockAgent } from "undici";
import { SourceRequestGate } from "../../src/modules/acquisition/sources/infrastructure/request-gate.js";
import { JackettClient } from "../../src/modules/acquisition/sources/jackett/client.js";
import { JackettTransport } from "../../src/modules/acquisition/sources/jackett/transport.js";
import { acquisitionSearchTitles } from "../../src/modules/anime/release-assessment/search-titles.js";

const text = Type.String({ minLength: 1 });
const nullable = Type.Union([text, Type.Null()]);
const count = Type.Integer({ minimum: 0 });
const schema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	provenance: text,
	entries: Type.Array(
		Type.Object({ id: text, title: text, url: text, sourceCaseId: text }),
		{ minItems: 1 },
	),
	cases: Type.Array(
		Type.Object({
			id: text,
			titles: Type.Array(
				Type.Object({
					value: text,
					kind: Type.Union([
						Type.Literal("romaji"),
						Type.Literal("english"),
						Type.Literal("native"),
						Type.Literal("alias"),
					]),
					language: nullable,
				}),
			),
			limit: Type.Integer({ minimum: 1, maximum: 100 }),
			pages: Type.Array(
				Type.Object({
					query: text,
					offset: count,
					entries: Type.Array(text),
					total: Type.Union([count, Type.Null()]),
				}),
			),
			expectedEntries: Type.Array(text),
			expectedOutcome: Type.Union([
				Type.Literal("matches"),
				Type.Literal("no_match"),
			]),
			expectedCoverage: Type.Object({
				limited: Type.Boolean(),
				reason: nullable,
				pages: count,
				queries: count,
			}),
		}),
		{ minItems: 1 },
	),
});
type Corpus = Static<typeof schema>;
export function validateDiscoveryCorpus(value: unknown): Corpus {
	if (!Check(schema, value)) throw new Error("Invalid discovery corpus.");
	if (
		new Set(value.entries.map((entry) => entry.id)).size !==
			value.entries.length ||
		new Set(value.cases.map((entry) => entry.id)).size !== value.cases.length
	)
		throw new Error("Duplicate discovery identity.");
	const known = new Set(value.entries.map((entry) => entry.id));
	for (const entry of value.cases) {
		if (
			[
				...entry.expectedEntries,
				...entry.pages.flatMap((page) => page.entries),
			].some((id) => !known.has(id))
		)
			throw new Error("Unknown publication reference.");
		if (
			new Set(
				entry.pages.map((page) => JSON.stringify([page.query, page.offset])),
			).size !== entry.pages.length
		)
			throw new Error("Duplicate discovery request.");
	}
	return value;
}
export async function loadDiscoveryCorpus(): Promise<Corpus> {
	return validateDiscoveryCorpus(
		JSON.parse(
			await readFile(
				new URL(
					"../fixtures/acquisition-discovery/corpus.json",
					import.meta.url,
				),
				"utf8",
			),
		),
	);
}
const xml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
export async function evaluateDiscoveryCorpus(corpus: Corpus) {
	validateDiscoveryCorpus(corpus);
	const rows = [];
	for (const entry of corpus.cases) {
		const agent = new MockAgent();
		agent.disableNetConnect();
		const base = "http://discovery-fixture:9117",
			secret = "fixture-only-key";
		const transport = new JackettTransport(
			base,
			secret,
			"fixture",
			pino({ level: "silent" }),
			agent,
		);
		const client = new JackettClient(transport, new SourceRequestGate(0));
		const requests: { query: string; offset: number }[] = [];
		const api = transport.api.bind(transport);
		transport.api = async (id, parameters, signal) => {
			if (parameters.t === "search")
				requests.push({
					query: parameters.q ?? "",
					offset: Number(parameters.offset),
				});
			return api(id, parameters, signal);
		};
		const intercept = (parameters: Record<string, string>, body: string) =>
			agent
				.get(base)
				.intercept({
					method: "GET",
					path: `/api/v2.0/indexers/example/results/torznab/api?${new URLSearchParams({ ...parameters, apikey: secret })}`,
				})
				.reply(200, body);
		intercept(
			{ t: "caps" },
			`<caps><limits max="100" default="${entry.limit}"/><searching><search available="yes" supportedParams="q"/></searching></caps>`,
		);
		for (const page of entry.pages) {
			const items = page.entries
				.map((id) => {
					const publication = corpus.entries.find((entry) => entry.id === id);
					if (!publication) throw new Error("Missing publication.");
					return `<item><title>${xml(publication.title)}</title><guid>${xml(publication.url)}</guid><enclosure type="application/x-bittorrent" url="https://example.org/offline-fixture/${id}.torrent"/></item>`;
				})
				.join("");
			const pagination =
				page.total === null
					? ""
					: `<torznab:response offset="${page.offset}" total="${page.total}"/>`;
			intercept(
				{
					t: "search",
					q: page.query,
					limit: String(entry.limit),
					offset: String(page.offset),
				},
				`<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${pagination}${items}</channel></rss>`,
			);
		}
		let actual: Awaited<ReturnType<JackettClient["search"]>> | null = null;
		let error: string | null = null;
		try {
			actual = await client.search(
				{
					generation: "fixture",
					indexerId: "example",
					titles: acquisitionSearchTitles(structuredClone(entry.titles)),
				},
				new AbortController().signal,
			);
			agent.assertNoPendingInterceptors();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			await client.close();
		}
		const ids =
			actual?.entries.map(
				(result) =>
					corpus.entries.find((entry) => entry.url === result.guid)?.id ??
					"unknown",
			) ?? [];
		const failures: string[] = [];
		if (!isDeepStrictEqual(ids, entry.expectedEntries))
			failures.push("entries");
		if (!isDeepStrictEqual(actual?.coverage, entry.expectedCoverage))
			failures.push("coverage");
		if (actual?.outcome !== entry.expectedOutcome) failures.push("outcome");
		if (
			!isDeepStrictEqual(
				requests,
				entry.pages.map((page) => ({ query: page.query, offset: page.offset })),
			)
		)
			failures.push("requests");
		if (actual?.entries.some((result) => !result.download))
			failures.push("download-locator");
		rows.push({
			id: entry.id,
			requests,
			candidateIds: ids,
			coverage: actual?.coverage ?? null,
			outcome: actual?.outcome ?? null,
			failures,
			error,
			passed: !error && !failures.length,
		});
	}
	return {
		event: "acquisition_discovery.evaluated",
		version: corpus.version,
		scope: corpus.provenance,
		total: rows.length,
		passed: rows.filter((row) => row.passed).length,
		failed: rows.filter((row) => !row.passed).length,
		rows,
	};
}
