import { type Static, type TSchema, Type } from "typebox";
import { Check } from "typebox/value";
import { abortable, pause } from "../domain/async.js";
import {
	MetadataError,
	type ProviderReference,
	type WorkDetails,
	type WorkSummary,
} from "../domain/model.js";
import { metadataPolicy as policy } from "../policy.js";
import type { MetadataProvider } from "../ports.js";
import { boundedBody } from "./transport.js";

const nullable = <T extends TSchema>(type: T) =>
	Type.Union([type, Type.Null()]);
const text = nullable(Type.String());
const integer = nullable(Type.Integer({ minimum: 0 }));
const date = Type.Union([
	Type.Object({ year: integer, month: integer, day: integer }),
	Type.Null(),
]);
const summarySchema = Type.Object({
	id: Type.Integer({ minimum: 1, maximum: 2147483647 }),
	type: Type.Literal("ANIME"),
	title: Type.Object({ romaji: text, english: text, native: text }),
	synonyms: nullable(Type.Array(Type.String())),
	startDate: date,
	seasonYear: integer,
	format: text,
	status: text,
	episodes: integer,
	season: text,
	coverImage: Type.Union([
		Type.Object({ extraLarge: text, large: text }),
		Type.Null(),
	]),
});
const detailSchema = Type.Object({
	...summarySchema.properties,
	description: text,
	bannerImage: text,
	endDate: date,
	duration: integer,
	countryOfOrigin: text,
	source: text,
	genres: nullable(Type.Array(Type.String())),
	tags: nullable(
		Type.Array(
			Type.Object({
				name: Type.String(),
				rank: integer,
				isGeneralSpoiler: Type.Boolean(),
				isMediaSpoiler: Type.Boolean(),
			}),
		),
	),
	studios: nullable(
		Type.Object({
			nodes: Type.Array(
				Type.Object({ id: Type.Integer({ minimum: 1 }), name: Type.String() }),
			),
		}),
	),
	averageScore: integer,
	siteUrl: text,
	updatedAt: integer,
	streamingEpisodes: nullable(
		Type.Array(
			Type.Object({ title: text, url: text, site: text, thumbnail: text }),
		),
	),
});
const pageInfo = Type.Object({
	currentPage: Type.Integer({ minimum: 1 }),
	perPage: Type.Integer({ minimum: 1, maximum: 50 }),
	hasNextPage: Type.Boolean(),
});
const summaryFields = `id type title { romaji english native } synonyms startDate { year month day } seasonYear format status episodes season coverImage { extraLarge large }`;
const queries = {
	search: `query SearchAnime($query: String!, $page: Int!, $perPage: Int!) { Page(page: $page, perPage: $perPage) { pageInfo { currentPage perPage hasNextPage } media(search: $query, type: ANIME, sort: SEARCH_MATCH) { ${summaryFields} } } }`,
	detail: `query AnimeDetails($id: Int!) { Media(id: $id, type: ANIME) { ${summaryFields} description(asHtml: false) bannerImage endDate { year month day } duration countryOfOrigin source(version: 3) genres tags { name rank isGeneralSpoiler isMediaSpoiler } studios(isMain: true) { nodes { id name } } averageScore siteUrl updatedAt streamingEpisodes { title url site thumbnail } } }`,
	relations: `query AnimeRelations($id: Int!) { Media(id: $id, type: ANIME) { relations { edges { relationType(version: 2) node { ${summaryFields} } } } } }`,
	airing: `query AnimeAiring($id: Int!, $page: Int!, $perPage: Int!) { Media(id: $id, type: ANIME) { airingSchedule(page: $page, perPage: $perPage) { pageInfo { currentPage perPage hasNextPage } nodes { id episode airingAt } } } }`,
};
function invalid(): MetadataError {
	return new MetadataError({
		code: "invalid-response",
		message: "AniList returned an incomplete or invalid response.",
		retryAt: null,
	});
}
function summary(raw: Static<typeof summarySchema>): WorkSummary {
	const titles: WorkSummary["titles"] = [];
	for (const [key, language] of [
		["romaji", null],
		["english", "en"],
		["native", null],
	] as const) {
		const value = raw.title[key];
		if (value) titles.push({ value, language, kind: key });
	}
	for (const value of raw.synonyms ?? [])
		if (value) titles.push({ value, language: null, kind: "alias" });
	if (!titles.length) throw invalid();
	return {
		unavailableFields: Object.entries(raw)
			.filter(([, value]) => value === null)
			.map(([key]) => key),
		reference: { provider: "anilist", mediaType: "anime", id: String(raw.id) },
		titles,
		year: raw.startDate?.year ?? raw.seasonYear,
		format: raw.format,
		status: raw.status,
		episodeCount: raw.episodes,
		airingSeason: raw.season,
		coverUrl: raw.coverImage?.extraLarge ?? raw.coverImage?.large ?? null,
	};
}
/** One shared instance in bootstrap; requests are paced and serialized conservatively. */
export class AniListProvider implements MetadataProvider {
	readonly capabilities = {
		key: "anilist",
		version: "anilist-v1",
		search: true,
		details: true,
		relations: true,
		airing: true,
		streamingLinks: true,
		canonicalEpisodes: false,
	} as const;
	private tail: Promise<void> = Promise.resolve();
	private nextRequestAt = 0;
	private interval: number;
	private queued = 0;
	constructor(
		private readonly options: {
			fetch?: typeof fetch;
			intervalMs?: number;
			timeoutMs?: number;
			attempts?: number;
			random?: () => number;
		} = {},
	) {
		this.interval = options.intervalMs ?? policy.requestIntervalMs;
	}
	private id(reference: ProviderReference): number {
		if (
			reference.provider !== "anilist" ||
			reference.mediaType !== "anime" ||
			!/^[1-9]\d*$/.test(reference.id) ||
			Number(reference.id) > 2147483647
		)
			throw new MetadataError({
				code: "invalid-request",
				message: "Invalid AniList anime reference.",
				retryAt: null,
			});
		return Number(reference.id);
	}
	private async request(
		query: string,
		variables: Record<string, unknown>,
		parent: AbortSignal,
	): Promise<unknown> {
		parent.throwIfAborted();
		if (this.queued >= policy.maximumPending)
			throw new MetadataError({
				code: "busy",
				message: "Metadata request queue is full. Retry shortly.",
				retryAt: null,
			});
		this.queued++;
		const previous = this.tail;
		let unlock = () => {};
		this.tail = new Promise<void>((resolve) => {
			unlock = resolve;
		});
		try {
			// Release the queue only after the previous request, even when this waiter cancels.
			await abortable(previous, parent);
			for (
				let attempt = 0;
				attempt < (this.options.attempts ?? policy.maximumAttempts);
				attempt++
			) {
				await pause(this.nextRequestAt - Date.now(), parent);
				this.nextRequestAt = Date.now() + this.interval;
				const signal = AbortSignal.any([
					parent,
					AbortSignal.timeout(
						this.options.timeoutMs ?? policy.requestTimeoutMs,
					),
				]);
				try {
					const response = await abortable(
						(this.options.fetch ?? fetch)("https://graphql.anilist.co", {
							method: "POST",
							redirect: "error",
							headers: {
								"Content-Type": "application/json",
								Accept: "application/json",
							},
							body: JSON.stringify({ query, variables }),
							signal,
						}),
						signal,
					);
					this.observe(response);
					if (!response.ok) {
						await response.body?.cancel();
						throw new MetadataError({
							code:
								response.status === 429
									? "rate-limited"
									: response.status === 404
										? "not-found"
										: response.status >= 500
											? "unavailable"
											: "invalid-request",
							message:
								"AniList request failed. Retry when the provider is available.",
							retryAt: response.status === 429 ? this.nextRequestAt : null,
						});
					}
					const bytes = await boundedBody(
						response,
						policy.responseMaximumBytes,
						signal,
					);
					let body: unknown;
					try {
						body = JSON.parse(Buffer.from(bytes).toString("utf8"));
					} catch {
						throw invalid();
					}
					if (!body || typeof body !== "object") throw invalid();
					const envelope = body as { data?: unknown; errors?: unknown };
					if (envelope.errors !== undefined) {
						if (!Array.isArray(envelope.errors)) throw invalid();
						if (envelope.errors.length) {
							const statuses = envelope.errors.map((error) =>
								error && typeof error === "object"
									? (error as { status?: unknown }).status
									: undefined,
							);
							const code = statuses.includes(429)
								? "rate-limited"
								: statuses.includes(404)
									? "not-found"
									: statuses.some(
												(status) => typeof status === "number" && status >= 500,
											)
										? "unavailable"
										: "invalid-response";
							if (code === "rate-limited")
								this.nextRequestAt = Math.max(
									this.nextRequestAt,
									Date.now() + 60000,
								);
							throw new MetadataError({
								code,
								message:
									"AniList returned a GraphQL error; partial data was not cached.",
								retryAt: code === "rate-limited" ? this.nextRequestAt : null,
							});
						}
					}
					if (!envelope.data) throw invalid();
					return envelope.data;
				} catch (error) {
					parent.throwIfAborted();
					const failure =
						error instanceof MetadataError
							? error
							: new MetadataError(
									{
										code: "unavailable",
										message:
											"AniList is unavailable or timed out. Retry shortly.",
										retryAt: null,
									},
									{ cause: error },
								);
					if (
						!["unavailable", "rate-limited"].includes(failure.failure.code) ||
						attempt + 1 >= (this.options.attempts ?? policy.maximumAttempts)
					)
						throw failure;
					await pause(
						250 * 2 ** attempt +
							Math.floor((this.options.random ?? Math.random)() * 250),
						parent,
					);
				}
			}
			throw invalid();
		} finally {
			this.queued--;
			void previous.finally(unlock);
		}
	}
	private observe(response: Response): void {
		const limit = Number(response.headers.get("x-ratelimit-limit"));
		if (Number.isSafeInteger(limit) && limit > 0)
			this.interval = Math.max(this.interval, Math.ceil(60000 / limit));
		const retry = response.headers.get("retry-after");
		const retryAt =
			retry === null
				? 0
				: /^\d+(?:\.\d+)?$/.test(retry)
					? Date.now() + Number(retry) * 1000
					: Date.parse(retry);
		const rawReset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
		const reset = Number.isFinite(rawReset) ? rawReset : 0;
		const remainingHeader = response.headers.get("x-ratelimit-remaining");
		const remaining = Number(remainingHeader);
		if (
			remainingHeader !== null &&
			Number.isSafeInteger(remaining) &&
			remaining > 0 &&
			reset > Date.now()
		)
			this.interval = Math.max(
				this.interval,
				Math.ceil((reset - Date.now()) / remaining),
			);
		if (response.status === 429 || remainingHeader === "0") {
			const supplied = Math.max(Number.isFinite(retryAt) ? retryAt : 0, reset);
			this.nextRequestAt = Math.max(
				this.nextRequestAt,
				supplied > Date.now() ? supplied : Date.now() + 60000,
			);
		}
	}
	async search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const raw = await this.request(
			queries.search,
			{ query, page, perPage },
			signal,
		);
		const schema = Type.Object({
			Page: Type.Object({
				pageInfo,
				media: Type.Array(summarySchema, { maxItems: 50 }),
			}),
		});
		if (!Check(schema, raw)) throw invalid();
		if (
			raw.Page.pageInfo.currentPage !== page ||
			raw.Page.pageInfo.perPage !== perPage ||
			raw.Page.media.length > perPage
		)
			throw invalid();
		return {
			raw,
			data: {
				items: raw.Page.media.map(summary),
				page,
				perPage,
				hasNextPage: raw.Page.pageInfo.hasNextPage,
			},
		};
	}
	async get(reference: ProviderReference, signal: AbortSignal) {
		const raw = await this.request(
			queries.detail,
			{ id: this.id(reference) },
			signal,
		);
		if (Check(Type.Object({ Media: Type.Null() }), raw))
			throw new MetadataError({
				code: "not-found",
				message: "Anime was not found on AniList.",
				retryAt: null,
			});
		if (
			!Check(Type.Object({ Media: detailSchema }), raw) ||
			String(raw.Media.id) !== reference.id
		)
			throw invalid();
		const media = raw.Media;
		const data: WorkDetails = {
			...summary(media),
			description: media.description,
			bannerUrl: media.bannerImage,
			startDate: media.startDate,
			endDate: media.endDate,
			durationMinutes: media.duration,
			country: media.countryOfOrigin,
			source: media.source,
			genres: media.genres ?? [],
			tags: (media.tags ?? []).map((tag) => ({
				name: tag.name,
				rank: tag.rank,
				spoiler: tag.isGeneralSpoiler || tag.isMediaSpoiler,
			})),
			studios: (media.studios?.nodes ?? []).map((studio) => ({
				id: String(studio.id),
				name: studio.name,
			})),
			averageScore: media.averageScore,
			siteUrl: media.siteUrl,
			providerUpdatedAt: media.updatedAt,
			streamingEpisodes: media.streamingEpisodes ?? [],
			episodeCatalog: "unavailable",
		};
		return { raw, data };
	}
	async relations(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const raw = await this.request(
			queries.relations,
			{ id: this.id(reference) },
			signal,
		);
		// Relations may include manga; retain anime nodes only, without inventing cross-provider mappings.
		const relationSummary = Type.Object({
			...summarySchema.properties,
			type: Type.Union([Type.Literal("ANIME"), Type.Literal("MANGA")]),
		});
		const schema = Type.Object({
			Media: Type.Object({
				relations: Type.Object({
					edges: Type.Array(
						Type.Object({ relationType: Type.String(), node: relationSummary }),
						{ maxItems: 1000 },
					),
				}),
			}),
		});
		if (!Check(schema, raw)) throw invalid();
		const items = raw.Media.relations.edges
			.filter((edge) => edge.node.type === "ANIME")
			.map((edge) => ({
				type: edge.relationType,
				work: summary({ ...edge.node, type: "ANIME" }),
			}));
		return {
			raw,
			data: {
				items: items.slice((page - 1) * perPage, page * perPage),
				page,
				perPage,
				hasNextPage: items.length > page * perPage,
			},
		};
	}
	async airing(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const raw = await this.request(
			queries.airing,
			{ id: this.id(reference), page, perPage },
			signal,
		);
		const schema = Type.Object({
			Media: Type.Object({
				airingSchedule: Type.Object({
					pageInfo,
					nodes: Type.Array(
						Type.Object({
							id: Type.Integer({ minimum: 1 }),
							episode: Type.Integer({ minimum: 1 }),
							airingAt: Type.Integer({ minimum: 0 }),
						}),
						{ maxItems: 50 },
					),
				}),
			}),
		});
		if (!Check(schema, raw)) throw invalid();
		const schedule = raw.Media.airingSchedule;
		if (
			schedule.pageInfo.currentPage !== page ||
			schedule.pageInfo.perPage !== perPage ||
			schedule.nodes.length > perPage
		)
			throw invalid();
		return {
			raw,
			data: {
				items: schedule.nodes.map((episode) => ({
					...episode,
					id: String(episode.id),
				})),
				page,
				perPage,
				hasNextPage: schedule.pageInfo.hasNextPage,
			},
		};
	}
}
