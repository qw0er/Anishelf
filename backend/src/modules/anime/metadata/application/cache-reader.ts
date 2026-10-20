import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { abortable } from "../domain/async.js";
import {
	type CachedMetadata,
	MetadataError,
	type MetadataFailure,
	type MetadataSnapshot,
	type ReadOptions,
	type WorkDetails,
} from "../domain/model.js";
import { detailFreshnessMs, metadataPolicy as policy } from "../policy.js";
import type {
	CacheEntry,
	MetadataProvider,
	MetadataStore,
	ProviderResult,
} from "../ports.js";

interface Pending {
	controller: AbortController;
	task: Promise<CacheEntry>;
	subscribers: number;
}
/** Owns cache freshness, subscriber cancellation, refresh and snapshot retention. */
export class MetadataCacheReader {
	private readonly pending = new Map<string, Pending>();
	private readonly lifetime = new AbortController();
	constructor(
		private readonly options: {
			store: MetadataStore;
			logger: Logger;
			now?: () => number;
		},
	) {}
	private invalid(message: string) {
		return new MetadataError({
			code: "invalid-request",
			message,
			retryAt: null,
		});
	}
	private now() {
		return (this.options.now ?? Date.now)();
	}
	private store<T>(operation: () => T): T {
		try {
			return operation();
		} catch (cause) {
			if (cause instanceof MetadataError) throw cause;
			throw new MetadataError(
				{
					code: "storage-unavailable",
					message:
						"Metadata cache could not be read or saved. Retry after checking storage.",
					retryAt: null,
				},
				{ cause },
			);
		}
	}
	async read<T>(
		provider: MetadataProvider,
		kind: CacheEntry["kind"],
		request: unknown,
		options: ReadOptions,
		load: (signal: AbortSignal) => Promise<ProviderResult<T>>,
		ttl: (data: T) => number,
	): Promise<CachedMetadata<T>> {
		this.lifetime.signal.throwIfAborted();
		const signal = options.signal ?? this.lifetime.signal;
		signal.throwIfAborted();
		if (options.refresh && options.cachedOnly)
			throw this.invalid("Refresh cannot be combined with cached-only reads.");
		const key = createHash("sha256")
			.update(
				JSON.stringify([
					provider.capabilities.key,
					provider.capabilities.version,
					policy.projectionVersion,
					kind,
					request,
				]),
			)
			.digest("hex");
		const cached = this.store(() => this.options.store.find(key));
		this.options.logger.trace(
			{
				event: "metadata.cache_read",
				provider: provider.capabilities.key,
				kind,
				hit: Boolean(cached),
				stale: cached ? this.expiresAt(cached) <= this.now() : undefined,
				cachedOnly: Boolean(options.cachedOnly),
				refresh: Boolean(options.refresh),
			},
			"Metadata cache read.",
		);
		if (options.cachedOnly) {
			if (!cached)
				throw new MetadataError({
					code: "not-found",
					message: "No cached metadata is available.",
					retryAt: null,
				});
			return this.envelope<T>(cached);
		}
		if (cached && !options.refresh) {
			if (
				this.expiresAt(cached) <= this.now() &&
				(!cached.failure?.retryAt || cached.failure.retryAt <= this.now())
			) {
				void this.subscribe(
					key,
					kind,
					load,
					ttl,
					this.lifetime.signal,
					provider.capabilities.key,
				).catch(() => {});
			}
			return this.envelope<T>(cached);
		}
		try {
			return this.envelope<T>(
				await this.subscribe(
					key,
					kind,
					load,
					ttl,
					signal,
					provider.capabilities.key,
				),
			);
		} catch (error) {
			signal.throwIfAborted();
			this.lifetime.signal.throwIfAborted();
			if (!cached) throw error;
			const latest = this.store(() => this.options.store.get(cached.id));
			return this.envelope<T>(latest ?? cached);
		}
	}
	private expiresAt(entry: CacheEntry): number {
		if (entry.kind !== "detail") return entry.expiresAt;
		// Apply shorter policy intervals to snapshots persisted before a policy change.
		return Math.min(
			entry.expiresAt,
			entry.fetchedAt + detailFreshnessMs((entry.data as WorkDetails).status),
		);
	}
	private envelope<T>(entry: CacheEntry): CachedMetadata<T> {
		this.store(() => this.options.store.touch(entry.id, this.now()));
		return {
			snapshotId: entry.id,
			fetchedAt: entry.fetchedAt,
			stale: this.expiresAt(entry) <= this.now(),
			refreshing: this.pending.has(entry.key),
			refreshError: entry.failure ? { ...entry.failure } : null,
			data: structuredClone(entry.data) as T,
		};
	}
	private async subscribe<T>(
		key: string,
		kind: CacheEntry["kind"],
		load: (signal: AbortSignal) => Promise<ProviderResult<T>>,
		ttl: (data: T) => number,
		signal: AbortSignal,
		provider: string,
	): Promise<CacheEntry> {
		signal.throwIfAborted();
		let pending = this.pending.get(key);
		if (pending?.controller.signal.aborted) {
			this.pending.delete(key);
			pending = undefined;
		}
		if (!pending) {
			if (this.pending.size >= policy.maximumPending)
				throw new MetadataError({
					code: "busy",
					message: "Metadata refresh queue is full. Retry shortly.",
					retryAt: null,
				});
			const started = performance.now();
			const requestId = createHash("sha256").update(key).digest("hex");
			this.options.logger.debug(
				{ event: "metadata.refresh_started", requestId, provider, kind },
				"Metadata refresh started.",
			);
			const controller = new AbortController();
			const combined = AbortSignal.any([
				controller.signal,
				this.lifetime.signal,
			]);
			const task = Promise.resolve().then(async () => {
				try {
					const result = await abortable(load(combined), combined);
					combined.throwIfAborted();
					const now = this.now();
					const id = createHash("sha256")
						.update(key)
						.update(JSON.stringify(result.data))
						.digest("hex");
					const entry: CacheEntry = {
						id,
						key,
						kind,
						data: result.data,
						fetchedAt: now,
						expiresAt: now + ttl(result.data),
						accessedAt: now,
						failure: null,
					};
					this.store(() => {
						this.options.store.save(entry);
						this.options.store.prune(policy.searchKeys, policy.snapshots);
					});
					this.options.logger.debug(
						{
							event: "metadata.refreshed",
							provider,
							requestId,
							elapsedMs: Math.round(performance.now() - started),
							kind,
							snapshotId: id,
						},
						"Metadata snapshot refreshed.",
					);
					return entry;
				} catch (cause) {
					combined.throwIfAborted();
					const failure: MetadataFailure =
						cause instanceof MetadataError
							? cause.failure
							: {
									code: "unavailable",
									message: "Metadata provider is unavailable. Retry shortly.",
									retryAt: null,
								};
					const cached = this.store(() => this.options.store.find(key));
					if (cached)
						this.store(() =>
							this.options.store.fail(cached.id, {
								...failure,
								retryAt: failure.retryAt ?? this.now() + 60000,
							}),
						);
					this.options.logger.warn(
						{
							event: "metadata.refresh_failed",
							kind,
							code: failure.code,
							provider,
							requestId,
							retryAt: failure.retryAt,
							retained: Boolean(cached),
							elapsedMs: Math.round(performance.now() - started),
							err: cause,
						},
						"Metadata refresh failed; usable snapshots are retained.",
					);
					throw cause instanceof MetadataError
						? cause
						: new MetadataError(failure, { cause });
				}
			});
			pending = { controller, task, subscribers: 0 };
			this.pending.set(key, pending);
			const current = pending;
			void task
				.finally(() => {
					if (this.pending.get(key) === current) this.pending.delete(key);
				})
				.catch(() => {});
		}
		pending.subscribers++;
		try {
			return await abortable(pending.task, signal);
		} finally {
			pending.subscribers--;
			if (!pending.subscribers) pending.controller.abort();
		}
	}
	snapshot(id: string): MetadataSnapshot {
		this.lifetime.signal.throwIfAborted();
		const entry = this.store(() => this.options.store.get(id));
		if (!entry)
			throw new MetadataError({
				code: "not-found",
				message: "Snapshot was not found.",
				retryAt: null,
			});
		return { kind: entry.kind, ...this.envelope(entry) } as MetadataSnapshot;
	}
	retain(id: string, ownerId: string): void {
		if (!ownerId || ownerId.length > 200)
			throw this.invalid("Supply a stable catalog owner ID.");
		if (!this.store(() => this.options.store.get(id)))
			throw new MetadataError({
				code: "not-found",
				message: "Snapshot was not found.",
				retryAt: null,
			});
		this.store(() => this.options.store.retain(id, ownerId));
	}
	release(id: string, ownerId: string): void {
		this.store(() => {
			this.options.store.release(id, ownerId);
			this.options.store.prune(policy.searchKeys, policy.snapshots);
		});
	}
	async close(): Promise<void> {
		this.lifetime.abort();
		await Promise.allSettled(
			[...this.pending.values()].map((pending) => pending.task),
		);
	}
}
