import { readFile } from "node:fs/promises";
import { workKey } from "@anishelf/contracts/references";
import pino from "pino";
import type {
	AniListMediaDetails,
	AniListMetadataApi,
} from "../../src/modules/anime/external-works/anilist/public.js";
import type {
	BangumiMetadataApi,
	BangumiSubject,
} from "../../src/modules/anime/external-works/bangumi/public.js";
import { MetadataNameEnrichment } from "../../src/modules/anime/external-works/metadata/application/name-enrichment.js";
import type { CachedMetadata } from "../../src/modules/anime/external-works/metadata/domain/model.js";
import type { WorkDetails } from "../../src/modules/anime/external-works/metadata/domain/source-model.js";
import { AniListProvider } from "../../src/modules/anime/external-works/metadata/infrastructure/anilist.js";
import { BangumiProvider } from "../../src/modules/anime/external-works/metadata/infrastructure/bangumi.js";
import type { SourceMetadataApi } from "../../src/modules/anime/external-works/metadata/ports.js";

const directory = new URL("../fixtures/title-enrichment/", import.meta.url);
type Verdict = "same-work" | "different-work" | "unresolved";
interface CorpusCase {
	id: string;
	snapshot: string;
	bangumiId: number;
	expected: Verdict;
	split: string;
	tags: string[];
}
type AniListFields = Pick<
	AniListMediaDetails,
	| "id"
	| "title"
	| "type"
	| "synonyms"
	| "format"
	| "status"
	| "episodes"
	| "duration"
	| "seasonYear"
	| "startDate"
	| "endDate"
	| "siteUrl"
>;
interface Snapshot {
	id: string;
	anilist: {
		responseSha256: string;
		data: AniListFields & {
			relations: { edges: { node: { id: number; type: string } }[] };
		};
	};
	bangumiCandidates: {
		responseSha256: string;
		data: Pick<
			BangumiSubject,
			"id" | "name" | "name_cn" | "date" | "platform" | "eps" | "infobox"
		> & { type: number; total_episodes?: number };
	}[];
}
interface Diagnostic {
	event: string;
	state?: "confirmed" | "conflict" | "insufficient";
	reasons?: string[];
	matchedNames?: number;
	reason?: string;
	candidateCounts?: (number | null)[];
}
interface Outcome {
	candidateAssessments: Diagnostic[];
	snapshot: string;
	selectedBangumiId: number | null;
	rejectionReasons: string[];
	candidateCounts: (number | null)[][];
	error: string | null;
	poolSizes: { anilist: number; bangumi: number };
	excludedNonAnimeIds: number[];
}
function unavailable(): never {
	throw new Error("Unrecorded transport operation: this evaluator is offline.");
}
function envelope(data: WorkDetails): CachedMetadata<WorkDetails> {
	return {
		data,
		snapshotId: workKey(data.reference),
		fetchedAt: 0,
		stale: false,
		refreshing: false,
		refreshError: null,
	};
}

/** Production adapters interpret names, types and dates; only unrelated display fields are filled. */
async function project(snapshot: Snapshot) {
	const ani = new AniListProvider({
		get: async () => ({
			data: {
				...snapshot.anilist.data,
				season: null,
				coverImage: null,
				bannerImage: null,
				description: null,
				nextAiringEpisode: null,
				countryOfOrigin: null,
				source: null,
				genres: [],
				tags: [],
				studios: { nodes: [] },
				averageScore: null,
				updatedAt: null,
				streamingEpisodes: [],
			} as AniListMediaDetails,
		}),
		search: unavailable,
		relations: unavailable,
		airing: unavailable,
	} satisfies AniListMetadataApi);
	const signal = new AbortController().signal;
	const origin = (
		await ani.get(
			{
				provider: "anilist",
				mediaType: "anime",
				id: String(snapshot.anilist.data.id),
			},
			signal,
		)
	).data;
	const peers: WorkDetails[] = [];
	for (const entry of snapshot.bangumiCandidates) {
		// The real Bangumi protocol accepts anime (type 2) only, before adapter projection.
		if (entry.data.type !== 2) continue;
		const provider = new BangumiProvider({
			get: async () =>
				({
					...entry.data,
					summary: "",
					tags: [],
					rating: { score: 0 },
					images: null,
					type: 2,
				}) as BangumiSubject,
			search: unavailable,
		} satisfies BangumiMetadataApi);
		peers.push(
			(
				await provider.get(
					{
						provider: "bangumi",
						mediaType: "anime",
						id: String(entry.data.id),
					},
					signal,
				)
			).data,
		);
	}
	return {
		origin,
		peers,
		capabilities: [
			ani.capabilities,
			new BangumiProvider({ get: unavailable, search: unavailable })
				.capabilities,
		],
	};
}

function metrics(
	rows: { expected: Verdict; accepted: boolean; passed: boolean }[],
) {
	const positives = rows.filter((row) => row.expected === "same-work");
	const negatives = rows.filter((row) => row.expected === "different-work");
	const unresolved = rows.filter((row) => row.expected === "unresolved");
	const truePositives = positives.filter((row) => row.accepted).length;
	const falsePositives = negatives.filter((row) => row.accepted).length;
	return {
		total: rows.length,
		passed: rows.filter((row) => row.passed).length,
		positives: positives.length,
		truePositives,
		falseNegatives: positives.length - truePositives,
		positiveRecall: positives.length ? truePositives / positives.length : null,
		negatives: negatives.length,
		falsePositives,
		falsePositiveRate: negatives.length
			? falsePositives / negatives.length
			: null,
		unresolved: unresolved.length,
		unresolvedAccepted: unresolved.filter((row) => row.accepted).length,
	};
}

/** Manual-only candidate-verification test. Does not replay unrecorded live searches. */
export async function testTitleEnrichmentCorpus(split?: string) {
	const { cases } = JSON.parse(
		await readFile(new URL("cases.json", directory), "utf8"),
	) as { cases: CorpusCase[] };
	const snapshots = new Map<string, Snapshot>();
	for (const key of new Set(cases.map((item) => item.snapshot))) {
		const data = JSON.parse(
			await readFile(new URL(`snapshots/${key}.json`, directory), "utf8"),
		) as Snapshot;
		if (data.id !== key) throw new Error(`Snapshot ID mismatch: ${key}`);
		snapshots.set(key, data);
	}
	const projected = new Map<string, Awaited<ReturnType<typeof project>>>();
	for (const [key, snapshot] of snapshots)
		projected.set(key, await project(snapshot));
	const selectedCases = cases.filter((item) => !split || item.split === split);
	if (!selectedCases.length) throw new Error(`No cases for split: ${split}`);
	const selectedSnapshots = new Set(selectedCases.map((item) => item.snapshot));
	const outcomes = new Map<string, Outcome>();
	for (const [key, snapshot] of snapshots) {
		if (!selectedSnapshots.has(key)) continue;
		const own = projected.get(key);
		if (!own) throw new Error(`Missing projection: ${key}`);
		const diagnostics: Diagnostic[] = [];
		const logger = pino(
			{ level: "debug" },
			{
				write: (line: string) =>
					diagnostics.push(JSON.parse(line) as Diagnostic),
			},
		);
		// Pool membership is independent of the expected labels and counterpart IDs.
		// Include all captured Bangumi candidates, and independently captured related AniList anchors.
		const relatedIds = new Set(
			snapshot.anilist.data.relations.edges
				.filter((edge) => edge.node.type === "ANIME")
				.map((edge) => edge.node.id),
		);
		const anilistPool = [
			own.origin,
			...[...projected.values()]
				.filter(
					(entry) =>
						entry.origin.reference.id !== own.origin.reference.id &&
						relatedIds.has(Number(entry.origin.reference.id)),
				)
				.map((entry) => entry.origin),
		];
		const pool = [...anilistPool, ...own.peers];
		const byId = new Map(pool.map((item) => [workKey(item.reference), item]));
		const source: Pick<
			SourceMetadataApi,
			"providers" | "search" | "get" | "current"
		> = {
			providers: () => own.capabilities,
			get: async (reference) => {
				const data = byId.get(workKey(reference));
				if (!data) throw new Error(`Uncaptured detail: ${workKey(reference)}`);
				return envelope(data);
			},
			current: (reference) => {
				const data = byId.get(workKey(reference));
				return data ? envelope(data) : null;
			},
			search: async (request) => {
				const items = pool.filter(
					(item) => item.reference.provider === request.provider,
				);
				if (items.length > 50)
					throw new Error(
						"Controlled pool exceeds one source page; extend the evaluator explicitly.",
					);
				return {
					...envelope(own.origin),
					data: { items, page: 1, perPage: 50, hasNextPage: false },
				};
			},
		};
		const matcher = new MetadataNameEnrichment(source, logger);
		let selectedBangumiId: number | null = null;
		let error: string | null = null;
		try {
			const enriched = await matcher.enrich(
				envelope(own.origin),
				{},
				{ throwOnFailure: true },
			);
			const proof = matcher.proof(enriched);
			selectedBangumiId =
				proof?.peer.provider === "bangumi" ? Number(proof.peer.id) : null;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
		outcomes.set(key, {
			candidateAssessments: diagnostics.filter(
				(item) => item.event === "metadata.name_candidate_assessed",
			),
			snapshot: key,
			selectedBangumiId,
			rejectionReasons: diagnostics
				.filter(
					(item) =>
						item.event === "metadata.name_enrichment_rejected" ||
						item.event === "metadata.name_enrichment_skipped",
				)
				.map((item) => item.reason ?? item.event),
			candidateCounts: diagnostics.flatMap((item) =>
				item.candidateCounts ? [item.candidateCounts] : [],
			),
			error,
			poolSizes: { anilist: anilistPool.length, bangumi: own.peers.length },
			excludedNonAnimeIds: snapshot.bangumiCandidates
				.filter((item) => item.data.type !== 2)
				.map((item) => item.data.id),
		});
	}
	const rows = selectedCases.map((item) => {
		const outcome = outcomes.get(item.snapshot);
		if (!outcome) throw new Error(`Missing outcome: ${item.snapshot}`);
		const accepted = outcome.selectedBangumiId === item.bangumiId;
		return {
			...item,
			accepted,
			passed:
				outcome.error === null &&
				(item.expected === "same-work" ? accepted : !accepted),
			outcome,
		};
	});
	const wrongCounterparts = [...outcomes.values()].filter(
		(outcome) =>
			outcome.selectedBangumiId !== null &&
			!cases.some(
				(item) =>
					item.snapshot === outcome.snapshot &&
					item.expected === "same-work" &&
					item.bangumiId === outcome.selectedBangumiId,
			),
	);
	const grouped = (field: "tags" | "split") =>
		Object.fromEntries(
			[
				...new Set(
					selectedCases.flatMap((item) =>
						field === "tags" ? item.tags : [item.split],
					),
				),
			]
				.sort()
				.map((key) => [
					key,
					metrics(
						rows.filter((item) =>
							field === "tags" ? item.tags.includes(key) : item.split === key,
						),
					),
				]),
		);
	return {
		event: "title_corpus.matcher_test",
		scope:
			"Production adapters and MetadataNameEnrichment over controlled frozen candidate pools; NOT live search replay or retrieval recall. Candidate membership does not use expected labels. Missing unrelated fields are neutral projection defaults.",
		summary: metrics(rows),
		runtimeErrors: [...outcomes.values()].filter(
			(outcome) => outcome.error !== null,
		),
		wrongCounterpartSelections: wrongCounterparts,
		bySplit: grouped("split"),
		byTag: grouped("tags"),
		results: rows,
		failed: rows.some((row) => !row.passed) || wrongCounterparts.length > 0,
	};
}
