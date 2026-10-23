import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { TrackingListSnapshot } from "../domain/list.js";
import { TrackingProviderError } from "../domain/list.js";
import type {
	TrackingListAccess,
	TrackingListProvider,
	TrackingListStore,
} from "../ports.js";

interface Active {
	generation: string;
	controller: AbortController;
	task: Promise<void>;
}
export interface TrackingListReaderOptions {
	access: TrackingListAccess;
	store: TrackingListStore;
	provider: TrackingListProvider;
	logger?: Logger;
	now?: () => number;
	freshMs?: number;
}
/** Owns freshness, deduplication, recovery and atomic publication, never matching. */
export class TrackingListReader {
	private readonly failures = new Map<
		string,
		{ code: string; retryAt: number | null }
	>();
	private active: Active | undefined;
	private stopped = false;
	private mutationRevision = 0;
	private readonly logger: Logger | undefined;
	constructor(private readonly options: TrackingListReaderOptions) {
		this.logger = options.logger?.child({ module: "tracking-list" });
	}
	private now() {
		return (this.options.now ?? Date.now)();
	}
	private assert(generation?: string) {
		if (this.stopped)
			throw new DomainError(
				"TRACKING_UNAVAILABLE",
				"Tracking list reader stopped.",
			);
		if (generation !== undefined) this.options.access.assertCurrent(generation);
	}
	read(generation?: string, refreshStale = true): TrackingListSnapshot {
		this.assert(generation);
		const status = this.options.access.status();
		if (this.active && this.active.generation !== status.generation)
			this.active.controller.abort();
		const cache = status.account
			? this.options.store.read(status.account.id)
			: undefined;
		const stale =
			status.state !== "connected" ||
			!cache ||
			cache.invalidated === true ||
			this.now() - cache.fetchedAt >= (this.options.freshMs ?? 300_000);
		const failure = this.failures.get(status.generation) ?? null;
		if (
			refreshStale &&
			stale &&
			status.state === "connected" &&
			(!failure || (failure.retryAt !== null && failure.retryAt <= this.now()))
		)
			void this.refresh(status.generation).catch(() => {});
		return {
			provider: status.provider,
			accountId: status.account?.id ?? null,
			generation: status.generation,
			state: status.state,
			fetchedAt: cache?.fetchedAt ?? null,
			stale,
			refreshing: this.active?.generation === status.generation,
			error: failure,
			entries: cache?.entries ?? [],
		};
	}
	async refresh(generation?: string): Promise<TrackingListSnapshot> {
		this.assert(generation);
		const status = this.options.access.status();
		if (!status.account || status.state !== "connected")
			return this.read(generation, false);
		if (this.active?.generation === status.generation) {
			await this.active.task;
			return this.read(generation, false);
		}
		this.active?.controller.abort();
		const controller = new AbortController();
		const active: Active = {
			generation: status.generation,
			controller,
			task: Promise.resolve(),
		};
		this.active = active;
		active.task = this.fetch(status.generation, controller).finally(() => {
			if (this.active === active) this.active = undefined;
		});
		await active.task;
		return this.read(generation, false);
	}
	private async fetch(generation: string, controller: AbortController) {
		const started = this.now();
		const mutationRevision = this.mutationRevision;
		this.failures.delete(generation);
		this.logger?.debug(
			{ event: "tracking.list_refresh_started", generation },
			"Refreshing Tracking lists.",
		);
		try {
			const lease = await this.options.access.acquire();
			if (lease.generation !== generation)
				throw new DomainError("TRACKING_CONFLICT", "Account changed.");
			const signal = AbortSignal.any([lease.signal, controller.signal]);
			const entries = await this.options.provider.read(lease, signal);
			signal.throwIfAborted();
			this.assert(generation);
			if (mutationRevision !== this.mutationRevision) return;
			this.options.store.replace({
				accountId: lease.accountId,
				entries,
				fetchedAt: this.now(),
			});
			this.logger?.info(
				{
					event: "tracking.list_refresh_completed",
					accountId: lease.accountId,
					count: entries.length,
					durationMs: this.now() - started,
				},
				"Tracking list snapshot published.",
			);
		} catch (error) {
			if (
				this.stopped ||
				controller.signal.aborted ||
				this.options.access.status().generation !== generation
			) {
				this.logger?.debug(
					{ event: "tracking.list_refresh_cancelled" },
					"Tracking list refresh cancelled.",
				);
				return;
			}
			const code =
				error instanceof TrackingProviderError
					? error.code
					: error instanceof DomainError &&
							error.code === "TRACKING_AUTHORIZATION_REQUIRED"
						? "unauthorized"
						: "unavailable";
			const retryAt =
				error instanceof TrackingProviderError && error.retryAt !== null
					? error.retryAt
					: code === "unauthorized"
						? null
						: this.now() + 60_000;
			this.failures.clear();
			this.failures.set(generation, { code, retryAt });
			if (code === "unauthorized")
				this.options.access.authorizationFailed(generation);
			this.logger?.warn(
				{
					event: "tracking.list_refresh_failed",
					code,
					retryAt,
					retainedCache: Boolean(
						this.options.store.read(
							this.options.access.status().account?.id ?? "",
						),
					),
				},
				"Tracking list refresh failed; previous snapshot retained.",
			);
		}
	}
	confirmed(
		accountId: string,
		mediaId: string,
		remote: import("../domain/operation.js").TrackingRemoteState | null,
	): void {
		this.mutationRevision++;
		const cache = this.options.store.read(accountId);
		if (cache) {
			this.options.store.replace({
				...cache,
				invalidated: true,
				entries: cache.entries.flatMap((entry) =>
					entry.mediaId !== mediaId
						? [entry]
						: remote
							? [{ ...entry, ...remote }]
							: [],
				),
			});
		}
	}
	acquisitionSnapshot() {
		const value = this.read(undefined, false);
		const cache = value.accountId
			? this.options.store.read(value.accountId)
			: undefined;
		const complete = Boolean(cache && !cache.invalidated);
		return {
			accountId: value.accountId,
			generation: value.generation,
			revision: complete
				? createHash("sha256")
						.update(
							JSON.stringify([
								value.accountId,
								value.generation,
								cache?.fetchedAt,
								value.entries
									.map((entry) => [entry.mediaId, entry.status, entry.progress])
									.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
							]),
						)
						.digest("hex")
				: null,
			complete,
			fresh:
				complete &&
				value.state === "connected" &&
				!value.stale &&
				!value.refreshing &&
				!value.error,
			refreshAllowed:
				value.state === "connected" &&
				!value.refreshing &&
				(!value.error ||
					(value.error.retryAt !== null && value.error.retryAt <= this.now())),
			retryAt: value.error?.retryAt ?? null,
			entries: value.entries.map((entry) => ({
				workKey: entry.mediaId,
				title: entry.titles[0] ?? entry.mediaId,
				status: entry.status,
				progress: entry.progress,
			})),
		};
	}
	async close() {
		this.stopped = true;
		this.active?.controller.abort();
		await this.active?.task;
		this.failures.clear();
	}
}
