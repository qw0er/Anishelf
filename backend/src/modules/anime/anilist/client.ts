import { randomUUID } from "node:crypto";
import {
	Anilist,
	ApiError,
	type ApiPlugin,
	createRateLimitPlugin,
	GraphQLRequestError,
	RateLimitError,
} from "@api-wrappers/anilist-wrapper";
import {
	createHeaderRateLimitPlugin,
	createRetryPlugin,
} from "@api-wrappers/api-core";
import { abortable } from "../../../shared/abortable.js";
import {
	type AniListClient,
	AniListError,
	type AniListFailureCode,
	type AniListOptions,
	type AniListRequestOptions,
} from "./domain/model.js";

/** SDK-native transport and shared SDK limiter instances; no custom request queue. */
export class AniListWrapper implements AniListClient {
	private readonly shutdown = new AbortController();
	private readonly pacing: ApiPlugin;
	private readonly feedback = createHeaderRateLimitPlugin();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly logger;
	constructor(private readonly options: AniListOptions = {}) {
		this.logger = options.logger?.child({ module: "anilist" });
		this.pacing = createRateLimitPlugin({
			maxConcurrent: 1,
			minTimeMs: options.intervalMs ?? 2400,
		});
		// Acquire the shared slot before checking server feedback. Record headers before
		// releasing it, so the next request observes an exhausted budget.
		this.pacing.priority = -10;
		this.logger?.debug(
			{
				event: "anilist.wrapper_configured",
				intervalMs: options.intervalMs ?? 2400,
				queryMaximumAttempts: options.attempts ?? 3,
				mutationMaximumAttempts: 1,
			},
			"AniList SDK request policy configured.",
		);
	}
	execute<T>(
		options: AniListRequestOptions,
		operation: (sdk: Anilist) => Promise<T>,
	): Promise<T> {
		const task = this.run(options, operation);
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	private async run<T>(
		options: AniListRequestOptions,
		operation: (sdk: Anilist) => Promise<T>,
	): Promise<T> {
		const signal = AbortSignal.any([options.signal, this.shutdown.signal]);
		const context = {
			requestId: randomUUID(),
			authenticated: Boolean(options.token),
		};
		const sdk = new Anilist({
			...(options.token ? { token: options.token } : {}),
			core: {
				...(this.options.fetch ? { fetch: this.options.fetch } : {}),
				timeoutMs: this.options.timeoutMs ?? 8000,
				retry: {
					maxAttempts: this.options.attempts ?? 3,
					delayMs: 500,
					jitter: false,
					retriableStatusCodes: [429, 500, 502, 503, 504],
				},
				plugins: [
					{
						name: "anishelf-operation",
						priority: -20,
						beforeRequest: (ctx) => {
							signal.throwIfAborted();
							ctx.signal = signal;
							this.logger?.trace(
								{
									event: "anilist.request_attempt",
									...context,
									attempt: ctx.attempt + 1,
								},
								"AniList SDK request attempt.",
							);
						},
					},
					// Use the SDK's conditional retry policy for unsafe writes.
					createRetryPlugin({
						maxAttempts: 1,
						when: (ctx) => {
							const body = ctx.body as { query?: string } | undefined;
							return /^\s*mutation\b/.test(body?.query ?? "");
						},
					}),
					this.pacing,
					this.feedback,
				],
			},
		});
		try {
			signal.throwIfAborted();
			const result = await abortable(operation(sdk), signal);
			this.logger?.trace(
				{ event: "anilist.request_succeeded", ...context },
				"AniList SDK request succeeded.",
			);
			return result;
		} catch (error) {
			const failure = signal.aborted
				? new AniListError({
						code: "unavailable",
						message: "AniList request cancelled.",
						retryAt: null,
					})
				: normalize(error, this.feedback.getState().blockedUntil ?? null);
			this.logger?.warn(
				{
					event: "anilist.request_failed",
					...context,
					code: failure.failure.code,
				},
				"AniList SDK request failed.",
			);
			throw failure;
		}
	}
	async close(): Promise<void> {
		this.shutdown.abort();
		await Promise.allSettled([...this.pending]);
		this.logger?.debug({ event: "anilist.stopped" }, "AniList SDK stopped.");
	}
}

function normalize(error: unknown, retryAt: number | null): AniListError {
	if (error instanceof AniListError) return error;
	const statuses =
		error instanceof GraphQLRequestError
			? error.graphqlErrors.map((item) =>
					"status" in item ? item.status : undefined,
				)
			: [];
	if (error instanceof ApiError) statuses.push(error.status);
	let code: AniListFailureCode = "unavailable";
	if (statuses.includes(401) || statuses.includes(403)) code = "unauthorized";
	else if (statuses.includes(429)) code = "rate-limited";
	else if (statuses.includes(404)) code = "not-found";
	else if (statuses.includes(400)) code = "invalid-request";
	else if (
		statuses.some((status) => typeof status === "number" && status >= 500)
	)
		code = "unavailable";
	else if (
		error instanceof GraphQLRequestError ||
		error instanceof SyntaxError ||
		(error instanceof ApiError && error.status >= 200 && error.status < 300)
	)
		code = "invalid-response";
	if (error instanceof RateLimitError && error.retryAfterMs !== undefined)
		retryAt = Date.now() + error.retryAfterMs;
	// Never retain SDK errors: response bodies and causes may echo credentials.
	return new AniListError({
		code,
		message: "AniList request failed.",
		retryAt: code === "rate-limited" ? retryAt : null,
	});
}
