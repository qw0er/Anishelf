import { MetadataError, type MetadataFailure } from "../../metadata/public.js";
import { catalogPolicy as policy } from "../policy.js";
import type { CatalogContext } from "./context.js";
import type { WorkApplication } from "./work.js";

/** Bounded, rotating checks of associated works; Metadata owns provider pacing and retries. */
export class CatalogRefresh {
	private readonly lifetime = new AbortController();
	private readonly pending = new Map<string, Promise<void>>();
	private readonly failures = new Map<string, MetadataFailure>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private cursor = "";
	private scanning: Promise<void> | undefined;
	constructor(
		private readonly context: CatalogContext,
		private readonly work: WorkApplication,
	) {
		this.schedule(policy.refreshStartupMs);
	}
	private schedule(delay: number): void {
		if (this.lifetime.signal.aborted) return;
		this.timer = setTimeout(() => {
			this.scanning = this.scan()
				.catch((err: unknown) => {
					if (!this.lifetime.signal.aborted)
						this.context.options.logger.warn(
							{ event: "catalog.refresh_scan_failed", err },
							"Catalog refresh check failed.",
						);
				})
				.finally(() => this.schedule(policy.refreshIntervalMs));
		}, delay);
		this.timer.unref();
	}
	private snapshot(id: string) {
		const link = this.context.options.store.link(id);
		if (!link) return null;
		const snapshot = this.context.options.metadata.snapshot(link.snapshotId);
		return snapshot.kind === "detail" ? snapshot : null;
	}
	request(id: string): boolean {
		if (this.lifetime.signal.aborted) return false;
		if (this.pending.has(id)) return true;
		if (this.pending.size >= policy.maximumRefreshes) return false;
		const snapshot = this.snapshot(id);
		if (snapshot && !snapshot.stale) this.failures.delete(id);
		if (
			!snapshot?.stale ||
			(this.failures.get(id)?.retryAt ?? 0) > Date.now() ||
			(snapshot.refreshError?.retryAt &&
				snapshot.refreshError.retryAt > Date.now())
		)
			return false;
		const task = Promise.resolve()
			.then(() => this.work.revalidate(id, this.lifetime.signal))
			.then((failure) => {
				if (failure) this.fail(id, failure);
				else this.failures.delete(id);
			})
			.catch((err: unknown) => {
				if (!this.lifetime.signal.aborted) {
					this.fail(
						id,
						err instanceof MetadataError
							? err.failure
							: {
									code: "unavailable",
									message: "Metadata could not be refreshed. Retry shortly.",
									retryAt: null,
								},
					);
					this.context.options.logger.warn(
						{ event: "catalog.refresh_failed", workId: id, err },
						"Catalog refresh failed; the retained snapshot remains usable.",
					);
				}
			})
			.finally(() => this.pending.delete(id));
		this.pending.set(id, task);
		return true;
	}
	failure(id: string): MetadataFailure | null {
		return this.failures.get(id) ?? null;
	}
	private fail(id: string, failure: MetadataFailure): void {
		this.failures.delete(id);
		this.failures.set(id, {
			...failure,
			retryAt: failure.retryAt ?? Date.now() + 60_000,
		});
		if (this.failures.size > policy.maximumRefreshFailures) {
			const oldest = this.failures.keys().next().value;
			if (oldest !== undefined) this.failures.delete(oldest);
		}
	}
	private async scan(): Promise<void> {
		const works = this.context.options.store.refreshWorks(
			this.cursor,
			policy.refreshScanSize,
		);
		const candidates: { id: string; fetchedAt: number }[] = [];
		for (const work of works) {
			this.cursor = work.id;
			const snapshot = this.snapshot(work.id);
			if (
				snapshot?.data.status !== "FINISHED" &&
				snapshot?.stale &&
				(!snapshot.refreshError?.retryAt ||
					snapshot.refreshError.retryAt <= Date.now())
			) {
				candidates.push({ id: work.id, fetchedAt: snapshot.fetchedAt });
				if (candidates.length >= policy.maximumRefreshes) break;
			}
		}
		if (
			(works.length < policy.refreshScanSize &&
				this.cursor === works.at(-1)?.id) ||
			!works.length
		)
			this.cursor = "";
		for (const candidate of candidates.sort(
			(a, b) => a.fetchedAt - b.fetchedAt,
		))
			this.request(candidate.id);
		await Promise.allSettled(this.pending.values());
	}
	close(): void {
		this.lifetime.abort();
		clearTimeout(this.timer);
	}
	async quiesce(): Promise<void> {
		this.close();
		await Promise.allSettled([
			...this.pending.values(),
			...(this.scanning ? [this.scanning] : []),
		]);
	}
}
