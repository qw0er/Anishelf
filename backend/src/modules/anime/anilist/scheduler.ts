import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { abortable, pause } from "./domain/async.js";
import {
	type AniListClient,
	AniListError,
	type AniListOptions,
} from "./domain/model.js";
import { boundedBody } from "./infrastructure/transport.js";

const policy = {
	maximumAttempts: 3,
	requestTimeoutMs: 8000,
	responseMaximumBytes: 2 * 1024 * 1024,
};
function invalid() {
	return new AniListError({
		code: "invalid-response",
		message: "AniList returned an invalid response.",
		retryAt: null,
	});
}
type RequestContext = {
	requestId: string;
	kind: "query" | "mutation";
	authenticated: boolean;
	priority: boolean;
};
type Job = {
	context: RequestContext;
	queuedAt: number;
	priority: boolean;
	signal: AbortSignal;
	run(): Promise<unknown>;
	resolve(value: unknown): void;
	reject(error: unknown): void;
	detach(): void;
};
/** One process-local budget for public metadata and personal account requests. */
export class AniListScheduler implements AniListClient {
	private readonly logger: Logger | undefined;
	private nextRequestAt = 0;
	private interval: number;
	private readonly shutdown = new AbortController();
	private readonly queue: Job[] = [];
	private running: Promise<void> | undefined;
	private priorityStreak = 0;
	constructor(private readonly options: AniListOptions = {}) {
		this.interval = options.intervalMs ?? 2400;
		this.logger = options.logger?.child({ module: "anilist" });
	}
	request(
		query: string,
		variables: Record<string, unknown>,
		options: { signal: AbortSignal; token?: string; priority?: boolean },
	): Promise<unknown> {
		const context: RequestContext = {
			requestId: randomUUID(),
			kind: /^\s*mutation\b/.test(query) ? "mutation" : "query",
			authenticated: Boolean(options.token),
			priority: options.priority ?? false,
		};
		const signal = AbortSignal.any([options.signal, this.shutdown.signal]);
		if (signal.aborted) {
			this.logger?.debug(
				{
					event: "anilist.request_cancelled",
					...context,
					stage: "admission",
					reason: this.shutdown.signal.aborted ? "shutdown" : "caller",
				},
				"AniList request cancelled.",
			);
			return Promise.reject(new Error("AniList request cancelled."));
		}
		if (this.queue.length >= (this.options.maximumPending ?? 100)) {
			this.logger?.warn(
				{
					event: "anilist.queue_full",
					...context,
					queueDepth: this.queue.length,
				},
				"AniList request queue is full.",
			);
			return Promise.reject(
				new AniListError({
					code: "busy",
					message: "AniList request queue is full.",
					retryAt: null,
				}),
			);
		}
		return new Promise((resolve, reject) => {
			const cancel = () => {
				const index = this.queue.indexOf(job);
				if (index >= 0) {
					this.queue.splice(index, 1);
					job.detach();
					this.logger?.debug(
						{
							event: "anilist.request_cancelled",
							...context,
							stage: "queued",
							reason: this.shutdown.signal.aborted ? "shutdown" : "caller",
							queueDepth: this.queue.length,
						},
						"Queued AniList request cancelled.",
					);
					reject(new Error("AniList request cancelled."));
				}
			};
			const job: Job = {
				context,
				queuedAt: Date.now(),
				priority: options.priority ?? false,
				signal,
				run: () =>
					this.execute(query, variables, signal, context, options.token),
				resolve,
				reject,
				detach: () => signal.removeEventListener("abort", cancel),
			};
			signal.addEventListener("abort", cancel, { once: true });
			this.queue.push(job);
			this.logger?.trace(
				{
					event: "anilist.request_queued",
					...context,
					queueDepth: this.queue.length,
				},
				"AniList request queued.",
			);
			this.start();
		});
	}
	private start() {
		this.running ??= Promise.resolve()
			.then(() => this.drain())
			.finally(() => {
				this.running = undefined;
				if (this.queue.length) this.start();
			});
	}
	private async drain() {
		while (this.queue.length) {
			const normal = this.queue.findIndex((job) => !job.priority);
			const urgent = this.queue.findIndex((job) => job.priority);
			const index =
				urgent >= 0 && (this.priorityStreak < 3 || normal < 0)
					? urgent
					: Math.max(0, normal);
			const job = this.queue.splice(index, 1)[0];
			if (!job) continue;
			job.detach();
			this.priorityStreak = job.priority ? this.priorityStreak + 1 : 0;
			try {
				const startedAt = Date.now();
				this.logger?.debug(
					{
						event: "anilist.request_started",
						...job.context,
						queueWaitMs: startedAt - job.queuedAt,
						queueDepth: this.queue.length,
					},
					"AniList request started.",
				);
				const value = await job.run();
				this.logger?.trace(
					{
						event: "anilist.request_succeeded",
						...job.context,
						durationMs: Date.now() - startedAt,
					},
					"AniList request completed.",
				);
				job.resolve(value);
			} catch (error) {
				if (job.signal.aborted)
					this.logger?.debug(
						{
							event: "anilist.request_cancelled",
							...job.context,
							stage: "active",
							reason: this.shutdown.signal.aborted ? "shutdown" : "caller",
						},
						"Active AniList request cancelled.",
					);
				else
					this.logger?.warn(
						{
							event: "anilist.request_failed",
							...job.context,
							code:
								error instanceof AniListError
									? error.failure.code
									: "unavailable",
							durationMs: Date.now() - job.queuedAt,
						},
						"AniList request failed.",
					);
				job.reject(error);
			}
		}
	}
	async close() {
		this.logger?.debug(
			{ event: "anilist.stopping", queueDepth: this.queue.length },
			"Stopping AniList request scheduler.",
		);
		this.shutdown.abort(new Error("AniList scheduler stopped."));
		await this.running;
		this.logger?.debug(
			{ event: "anilist.stopped" },
			"AniList request scheduler stopped.",
		);
	}
	private async execute(
		query: string,
		variables: Record<string, unknown>,
		parent: AbortSignal,
		context: RequestContext,
		token?: string,
	): Promise<unknown> {
		parent.throwIfAborted();
		const attempts = /^\s*mutation\b/.test(query)
			? 1
			: (this.options.attempts ?? policy.maximumAttempts);
		for (let attempt = 0; attempt < attempts; attempt++) {
			const waitMs = Math.max(0, this.nextRequestAt - Date.now());
			if (waitMs > 0)
				this.logger?.trace(
					{
						event: "anilist.request_waiting",
						...context,
						waitMs,
						attempt: attempt + 1,
					},
					"Waiting for AniList request budget.",
				);
			await pause(waitMs, parent);
			this.nextRequestAt = Date.now() + this.interval;
			const signal = AbortSignal.any([
				parent,
				AbortSignal.timeout(this.options.timeoutMs ?? policy.requestTimeoutMs),
			]);
			try {
				const response = await abortable(
					(this.options.fetch ?? fetch)("https://graphql.anilist.co", {
						method: "POST",
						redirect: "error",
						headers: {
							"Content-Type": "application/json",
							Accept: "application/json",
							...(token ? { Authorization: `Bearer ${token}` } : {}),
						},
						body: JSON.stringify({ query, variables }),
						signal,
					}),
					signal,
				);
				this.logger?.trace(
					{
						event: "anilist.response_received",
						...context,
						attempt: attempt + 1,
						statusCode: response.status,
					},
					"AniList response received.",
				);
				this.observe(response, context);
				if (!response.ok) {
					await response.body?.cancel();
					throw new AniListError({
						code:
							response.status === 429
								? "rate-limited"
								: response.status === 401 || response.status === 403
									? "unauthorized"
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
							: statuses.includes(401) || statuses.includes(403)
								? "unauthorized"
								: statuses.includes(404)
									? "not-found"
									: statuses.some(
												(status) => typeof status === "number" && status >= 500,
											)
										? "unavailable"
										: "invalid-response";
						if (code === "rate-limited") {
							this.nextRequestAt = Math.max(
								this.nextRequestAt,
								Date.now() + 60000,
							);
							this.logger?.warn(
								{
									event: "anilist.rate_limited",
									...context,
									source: "graphql",
									retryAt: this.nextRequestAt,
								},
								"AniList GraphQL rate limit reached.",
							);
						}
						throw new AniListError({
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
					error instanceof AniListError
						? error
						: new AniListError({
								code: "unavailable",
								message: "AniList is unavailable or timed out. Retry shortly.",
								retryAt: null,
							});
				if (
					!["unavailable", "rate-limited"].includes(failure.failure.code) ||
					attempt + 1 >= attempts
				)
					throw failure;
				const delayMs =
					250 * 2 ** attempt +
					Math.floor((this.options.random ?? Math.random)() * 250);
				this.logger?.warn(
					{
						event: "anilist.request_retrying",
						...context,
						code: failure.failure.code,
						attempt: attempt + 1,
						nextAttempt: attempt + 2,
						waitMs: Math.max(delayMs, this.nextRequestAt - Date.now()),
					},
					"Retrying AniList read request.",
				);
				await pause(delayMs, parent);
			}
		}
		throw invalid();
	}
	private observe(response: Response, context: RequestContext): void {
		const previousInterval = this.interval;
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
		if (this.interval > previousInterval)
			this.logger?.debug(
				{
					event: "anilist.pacing_changed",
					...context,
					intervalMs: this.interval,
				},
				"AniList request pacing slowed by provider feedback.",
			);
		if (response.status === 429 || remainingHeader === "0")
			this.logger?.warn(
				{
					event: "anilist.rate_limited",
					...context,
					source: "http",
					statusCode: response.status,
					retryAt: this.nextRequestAt,
				},
				"AniList request budget exhausted.",
			);
	}
}
