import createClient from "openapi-fetch";
import PQueue from "p-queue";
import type { Logger } from "pino";
import { type Static, type TSchema, Type } from "typebox";
import { Check, Errors } from "typebox/value";
import { buildInfo } from "../../../../platform/build-info.js";
import {
	BangumiError,
	type BangumiMetadataApi,
	type BangumiSubject,
	searchSchema,
	subjectSchema,
} from "./domain/model.js";
import type { components, paths } from "./openapi.gen.js";

const positiveId = Type.Integer({
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
});
const accountSchema = Type.Object({
	id: positiveId,
	username: Type.String({ minLength: 1 }),
	nickname: Type.String(),
});
const collectionSchema = Type.Object({
	subject_id: positiveId,
	subject_type: Type.Literal(2),
	type: Type.Union([
		Type.Literal(1),
		Type.Literal(2),
		Type.Literal(3),
		Type.Literal(4),
		Type.Literal(5),
	]),
	ep_status: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	updated_at: Type.String(),
	subject: Type.Optional(
		Type.Object({
			id: positiveId,
			name: Type.String(),
			name_cn: Type.String(),
			date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
			eps: Type.Optional(Type.Integer({ minimum: 0 })),
			images: Type.Optional(
				Type.Union([Type.Null(), Type.Object({ common: Type.String() })]),
			),
		}),
	),
});
const episodeSchema = Type.Object({
	id: positiveId,
	type: Type.Literal(0),
	ep: Type.Optional(Type.Number()),
	subject_id: Type.Optional(positiveId),
});
const episodeCollectionSchema = Type.Object({
	episode: episodeSchema,
	type: Type.Union([
		Type.Literal(0),
		Type.Literal(1),
		Type.Literal(2),
		Type.Literal(3),
	]),
});

type SubjectStatus = components["schemas"]["SubjectCollectionWrite"]["type"];

/** The shared limiter applies to both metadata and authenticated Tracking requests. */
export class BangumiClient implements BangumiMetadataApi {
	private readonly queue = new PQueue({
		concurrency: 1,
		intervalCap: 1,
		interval: 1000,
		strict: true,
	});
	private readonly lifetime = new AbortController();
	private retryAt = 0;
	private blockedCode: "rate-limited" | "unavailable" = "rate-limited";
	private readonly client;
	constructor(
		private readonly options: { logger: Logger; fetch?: typeof fetch },
	) {
		this.client = createClient<paths>({
			baseUrl: "https://api.bgm.tv",
			fetch: options.fetch ?? globalThis.fetch,
			headers: {
				"User-Agent": `qw0er/Anishelf/${buildInfo.version} (https://github.com/qw0er/Anishelf)`,
				Accept: "application/json",
			},
		});
		this.client.use({
			onResponse: async ({ response }) => {
				if (response.ok) return response;
				await response.body?.cancel();
				if (response.status === 429 || response.status >= 500) {
					const raw = response.headers.get("Retry-After");
					const seconds =
						raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
					const requested =
						seconds === null
							? Date.parse(raw ?? "")
							: Date.now() + seconds * 1000;
					this.retryAt = Math.max(
						this.retryAt,
						Date.now() + 60000,
						Number.isFinite(requested) ? requested : 0,
					);
					this.blockedCode =
						response.status === 429 ? "rate-limited" : "unavailable";
					this.options.logger.warn(
						{
							event: "bangumi.cooldown",
							status: response.status,
							retryAt: this.retryAt,
						},
						"Bangumi requests paused after upstream failure.",
					);
					this.checkCooldown();
				}
				throw new BangumiError({
					code:
						response.status === 404
							? "not-found"
							: response.status === 401 || response.status === 403
								? "unauthorized"
								: response.status === 400 || response.status === 422
									? "invalid-request"
									: "unavailable",
					message: "Bangumi request failed.",
					retryAt: null,
				});
			},
		});
		options.logger.debug(
			{
				event: "bangumi.client_configured",
				intervalMs: 1000,
				concurrency: 1,
				maximumPending: 50,
			},
			"Bangumi request limiter configured.",
		);
	}
	private checkCooldown() {
		if (this.retryAt > Date.now())
			throw new BangumiError({
				code: this.blockedCode,
				message:
					"Bangumi is temporarily unavailable. Retry after the cooldown.",
				retryAt: this.retryAt,
			});
	}
	private async request<T>(
		signal: AbortSignal,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const combined = AbortSignal.any([signal, this.lifetime.signal]);
		combined.throwIfAborted();
		this.checkCooldown();
		if (this.queue.size >= 50)
			throw new BangumiError({
				code: "busy",
				message: "Bangumi request queue is full.",
				retryAt: null,
			});
		return this.queue.add(
			async () => {
				combined.throwIfAborted();
				this.checkCooldown();
				const controller = new AbortController();
				const timer = setTimeout(
					() => controller.abort(new Error("Bangumi request timed out.")),
					8000,
				);
				const activeSignal = AbortSignal.any([combined, controller.signal]);
				const started = performance.now();
				try {
					const result = await operation(activeSignal);
					activeSignal.throwIfAborted();
					this.options.logger.debug(
						{
							event: "bangumi.request_completed",
							elapsedMs: Math.round(performance.now() - started),
						},
						"Bangumi request completed.",
					);
					return result;
				} catch (cause) {
					combined.throwIfAborted();
					this.options.logger.warn(
						{
							event: "bangumi.request_failed",
							code:
								cause instanceof BangumiError
									? cause.failure.code
									: "unavailable",
						},
						"Bangumi request failed.",
					);
					if (cause instanceof BangumiError) throw cause;
					throw new BangumiError(
						{
							code:
								cause instanceof SyntaxError
									? "invalid-response"
									: "unavailable",
							message: "Bangumi request could not be completed.",
							retryAt: null,
						},
						{ cause },
					);
				} finally {
					clearTimeout(timer);
				}
			},
			{ signal: combined },
		);
	}
	async search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const items: BangumiSubject[] = [];
		const start = (page - 1) * perPage;
		let total = start;
		// The live endpoint caps each wire page at 20, while Metadata uses pages of 50.
		while (items.length < perPage) {
			const offset = start + items.length;
			const limit = Math.min(20, perPage - items.length);
			const result = await this.request(signal, async (activeSignal) => {
				const { data } = await this.client.POST("/v0/search/subjects", {
					params: { query: { limit, offset } },
					body: { keyword: query, sort: "match", filter: { type: [2] } },
					signal: activeSignal,
				});
				if (!Check(searchSchema, data))
					throw this.invalid("search", "schema", Errors(searchSchema, data));
				if (
					data.limit !== limit ||
					data.offset !== offset ||
					data.data.length > limit
				)
					throw this.invalid("search", "pagination", [], {
						requestedLimit: limit,
						requestedOffset: offset,
						returnedLimit: data.limit,
						returnedOffset: data.offset,
						itemCount: data.data.length,
					});
				if (data.data.some((item) => !item.name.trim() && !item.name_cn.trim()))
					throw this.invalid("search", "missing_title");
				this.options.logger.debug(
					{
						event: "bangumi.names_received",
						operation: "search",
						subjects: data.data.length,
						withInfobox: data.data.filter((item) => Array.isArray(item.infobox))
							.length,
					},
					"Bangumi search name evidence received.",
				);
				return data;
			});
			items.push(...result.data);
			total = result.total;
			if (start + items.length >= total || result.data.length < limit) break;
		}
		return { items, page, perPage, hasNextPage: start + items.length < total };
	}

	get(id: number, signal: AbortSignal) {
		return this.request(signal, async (activeSignal) => {
			const { data } = await this.client.GET("/v0/subjects/{subject_id}", {
				params: { path: { subject_id: id } },
				signal: activeSignal,
			});
			if (!Check(subjectSchema, data))
				throw this.invalid("detail", "schema", Errors(subjectSchema, data));
			if (data.id !== id) throw this.invalid("detail", "subject_id");
			if (!data.name.trim() && !data.name_cn.trim())
				throw this.invalid("detail", "missing_title");
			this.options.logger.debug(
				{
					event: "bangumi.names_received",
					operation: "detail",
					subjectId: data.id,
					withInfobox: Array.isArray(data.infobox),
				},
				"Bangumi detail name evidence received.",
			);
			return data;
		});
	}
	private authorization(credential: string) {
		return { Authorization: `Bearer ${credential}` };
	}

	private checked<S extends TSchema>(schema: S, data: unknown): Static<S> {
		if (Check(schema, data)) return data;
		throw new BangumiError({
			code: "invalid-response",
			message: "Invalid Bangumi Tracking response.",
			retryAt: null,
		});
	}

	private async pages<S extends TSchema>(
		item: S,
		limit: number,
		signal: AbortSignal,
		page: (offset: number, signal: AbortSignal) => Promise<unknown>,
	): Promise<Static<S>[]> {
		const schema = Type.Object({
			total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
			offset: Type.Integer({ minimum: 0 }),
			limit: Type.Integer({ minimum: 1 }),
			data: Type.Array(item, { maxItems: limit }),
		});
		const results: Static<S>[] = [];
		while (true) {
			const offset = results.length;
			const data = await this.request(signal, async (active) =>
				this.checked(schema, await page(offset, active)),
			);
			if (
				data.offset !== offset ||
				data.data.length > data.limit ||
				(data.data.length === 0 && offset < data.total)
			)
				throw new BangumiError({
					code: "invalid-response",
					message: "Invalid Bangumi pagination.",
					retryAt: null,
				});
			results.push(...data.data);
			if (results.length >= data.total) return results;
		}
	}

	viewer(credential: string, signal: AbortSignal) {
		return this.request(signal, async (active) =>
			this.checked(
				accountSchema,
				(
					await this.client.GET("/v0/me", {
						headers: this.authorization(credential),
						signal: active,
					})
				).data,
			),
		);
	}

	collections(username: string, credential: string, signal: AbortSignal) {
		return this.pages(
			collectionSchema,
			50,
			signal,
			async (offset, active) =>
				(
					await this.client.GET("/v0/users/{username}/collections", {
						params: {
							path: { username },
							query: { subject_type: 2, limit: 50, offset },
						},
						headers: this.authorization(credential),
						signal: active,
					})
				).data,
		);
	}

	async collection(
		username: string,
		subjectId: number,
		credential: string,
		signal: AbortSignal,
	) {
		try {
			return await this.request(signal, async (active) =>
				this.checked(
					collectionSchema,
					(
						await this.client.GET(
							"/v0/users/{username}/collections/{subject_id}",
							{
								params: { path: { username, subject_id: subjectId } },
								headers: this.authorization(credential),
								signal: active,
							},
						)
					).data,
				),
			);
		} catch (error) {
			if (error instanceof BangumiError && error.failure.code === "not-found")
				return null;
			throw error;
		}
	}

	episodes(subjectId: number, signal: AbortSignal, credential?: string) {
		return this.pages(
			episodeSchema,
			100,
			signal,
			async (offset, active) =>
				(
					await this.client.GET("/v0/episodes", {
						params: {
							query: { subject_id: subjectId, type: 0, limit: 100, offset },
						},
						...(credential ? { headers: this.authorization(credential) } : {}),
						signal: active,
					})
				).data,
		);
	}

	episodeCollections(
		subjectId: number,
		credential: string,
		signal: AbortSignal,
	) {
		return this.pages(
			episodeCollectionSchema,
			100,
			signal,
			async (offset, active) =>
				(
					await this.client.GET(
						"/v0/users/-/collections/{subject_id}/episodes",
						{
							params: {
								path: { subject_id: subjectId },
								query: { episode_type: 0, limit: 100, offset },
							},
							headers: this.authorization(credential),
							signal: active,
						},
					)
				).data,
		);
	}

	writeCollection(
		subjectId: number,
		type: SubjectStatus,
		create: boolean,
		credential: string,
		signal: AbortSignal,
	) {
		return this.request(signal, async (active) => {
			const path = "/v0/users/-/collections/{subject_id}";
			const options = {
				params: { path: { subject_id: subjectId } },
				body: { type },
				headers: this.authorization(credential),
				signal: active,
			};
			if (create) await this.client.POST(path, options);
			else await this.client.PATCH(path, options);
		});
	}

	writeEpisodes(
		subjectId: number,
		episodeIds: number[],
		type: 0 | 2,
		credential: string,
		signal: AbortSignal,
	) {
		return this.request(signal, async (active) => {
			await this.client.PATCH("/v0/users/-/collections/{subject_id}/episodes", {
				params: { path: { subject_id: subjectId } },
				body: { episode_id: episodeIds, type },
				headers: this.authorization(credential),
				signal: active,
			});
		});
	}

	private invalid(
		operation: "search" | "detail",
		reason: "schema" | "pagination" | "subject_id" | "missing_title",
		issues: readonly { instancePath: string; message: string }[] = [],
		pagination?: Record<string, number>,
	) {
		this.options.logger.warn(
			{
				event: "bangumi.response_invalid",
				operation,
				reason,
				pagination,
				issues: issues.slice(0, 10).map(({ instancePath, message }) => ({
					path: instancePath,
					message,
				})),
			},
			"Bangumi response failed validation.",
		);
		return new BangumiError({
			code: "invalid-response",
			message: "Bangumi returned invalid metadata.",
			retryAt: null,
		});
	}
	async close() {
		this.lifetime.abort();
		await this.queue.onIdle();
	}
}
