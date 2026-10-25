import createClient from "openapi-fetch";
import PQueue from "p-queue";
import type { Logger } from "pino";
import { Check } from "typebox/value";
import { buildInfo } from "../../../platform/build-info.js";
import {
	BangumiError,
	type BangumiMetadataApi,
	searchSchema,
	subjectSchema,
} from "./domain/model.js";
import type { paths } from "./openapi.gen.js";

/** One process-wide client is shared by every Bangumi metadata operation. */
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
					code: response.status === 404 ? "not-found" : "unavailable",
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
	search(query: string, page: number, perPage: number, signal: AbortSignal) {
		return this.request(signal, async (activeSignal) => {
			const offset = (page - 1) * perPage;
			const { data } = await this.client.POST("/v0/search/subjects", {
				params: { query: { limit: perPage, offset } },
				body: { keyword: query, sort: "match", filter: { type: [2] } },
				signal: activeSignal,
			});
			if (
				!Check(searchSchema, data) ||
				data.limit !== perPage ||
				data.offset !== offset ||
				data.data.length > perPage ||
				data.data.some((item) => !item.name.trim() && !item.name_cn.trim())
			)
				throw this.invalid();
			return {
				items: data.data,
				page,
				perPage,
				hasNextPage: offset + data.data.length < data.total,
			};
		});
	}
	get(id: number, signal: AbortSignal) {
		return this.request(signal, async (activeSignal) => {
			const { data } = await this.client.GET("/v0/subjects/{subject_id}", {
				params: { path: { subject_id: id } },
				signal: activeSignal,
			});
			if (
				!Check(subjectSchema, data) ||
				data.id !== id ||
				(!data.name.trim() && !data.name_cn.trim())
			)
				throw this.invalid();
			return data;
		});
	}
	private invalid() {
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
