import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { SourceContext } from "../context.js";
import { SourceError, type SourceRecord } from "../domain/model.js";
import { SourceDownloads, type SourceTorrentTransport } from "../downloads.js";
import type { JackettConnection } from "../jackett/connection.js";
import type { JackettPlan } from "../jackett/model.js";
import type { SourceLifecycleStore } from "../lifecycle.js";
import type { SourceReference, SourceSnapshot, SourcesApi } from "../public.js";
import {
	RssSource,
	type RssSourceOptions,
	RssTransport,
} from "../rss/public.js";
import { SourceScheduler } from "../scheduler.js";

export interface SourcesApplicationOptions {
	rss: RssSourceOptions;
	store: SourceLifecycleStore;
	torrentTransport?: SourceTorrentTransport;
	jackett?: JackettConnection;
	logger: Logger;
	now?: () => number;
	refreshIntervalMinutes?: () => number | undefined;
}

export class SourcesApplication implements SourcesApi {
	private readonly context: SourceContext;
	private readonly rss: RssSource;
	private readonly downloads: SourceDownloads;
	private readonly prepared = new WeakMap<
		SourceSnapshot,
		{ record: SourceRecord; previousRevision: string | null }
	>();
	private readonly references = new WeakMap<SourceReference, JackettPlan>();
	private readonly queryResults = new WeakMap<
		SourceRecord,
		{ plan: JackettPlan; previousRevision: string | null }
	>();
	private readonly searching = new Map<string, Promise<SourceRecord>>();
	private scheduler: SourceScheduler | undefined;
	private closing: Promise<void> | undefined;
	constructor(private readonly options: SourcesApplicationOptions) {
		this.context = new SourceContext(options);
		this.rss = new RssSource(this.context, options.rss);
		this.downloads = new SourceDownloads(
			options.store,
			options.torrentTransport ?? new RssTransport(),
			options.jackett,
			this.context.signal,
			options.logger,
			(id) => this.record(id),
		);
	}
	private record(id: string): SourceRecord | null {
		const saved = this.options.store.source(id);
		return saved?.binding.kind === "jackett"
			? saved.snapshot
			: (this.rss.snapshot(id) ?? saved?.snapshot ?? null);
	}
	snapshot(id: string): SourceSnapshot | null {
		const record = this.record(id);
		return record ? this.project(record) : null;
	}
	private project(record: SourceRecord): SourceSnapshot {
		return Object.freeze({
			...record,
			...(record.coverage
				? { coverage: Object.freeze({ ...record.coverage }) }
				: {}),
			entries: Object.freeze(
				record.entries.map((entry) => this.downloads.project(record.id, entry)),
			),
		});
	}
	async refresh(reference: SourceReference): Promise<SourceSnapshot> {
		this.context.open();
		const previousRevision = this.record(reference.id)?.revision ?? null;
		const record = await this.prepare(reference);
		const result = this.project(record);
		this.prepared.set(result, {
			record,
			previousRevision,
		});
		return result;
	}
	isCurrent(result: SourceSnapshot) {
		if (this.context.signal.aborted) return false;
		const prepared = this.prepared.get(result);
		return Boolean(
			prepared &&
				((this.record(result.id)?.revision ?? null) ===
					prepared.previousRevision ||
					this.record(result.id)?.revision === result.revision) &&
				this.current(prepared.record),
		);
	}
	publish(result: SourceSnapshot) {
		this.context.open();
		const prepared = this.prepared.get(result);
		if (!prepared || !this.isCurrent(result))
			throw new SourceError("source_conflict");
		this.options.store.transaction(() => {
			if (!this.isCurrent(result)) throw new SourceError("source_conflict");
			this.publishRecord(prepared.record);
			const generation =
				this.queryResults.get(prepared.record)?.plan.generation ?? null;
			this.downloads.publish(prepared.record, generation);
		});
	}
	failed(previous: SourceSnapshot, code: string, retryAt?: number) {
		if (this.context.signal.aborted) return;
		const record = this.record(previous.id);
		if (record?.revision === previous.revision)
			this.recordFailed(record, code, retryAt);
	}
	readDownload(reference: string, signal: AbortSignal) {
		return this.downloads.read(reference, signal);
	}
	isDownloadCurrent(reference: string) {
		return this.downloads.isCurrent(reference);
	}

	bind(reference: SourceReference) {
		this.context.open();
		const plan = this.references.get(reference);
		if (plan) this.options.jackett?.plan(plan);
		const binding = plan
			? { kind: "jackett" as const, plan }
			: { kind: "rss" as const, url: this.rss.configuration(reference) };
		if (this.options.store.source(reference.id)) return;
		this.options.store.saveSource({
			id: reference.id,
			binding,
			enabled: false,
			failures: 0,
			snapshot: {
				id: reference.id,
				revision: randomUUID(),
				label:
					binding.kind === "jackett"
						? binding.plan.indexerId
						: new URL(binding.url).origin,
				entries: [],
				checkedAt: null,
				nextAttemptAt: 0,
				error: null,
			},
		});
		this.options.logger.debug(
			{ event: "acquisition.source_bound", sourceId: reference.id },
			"Source binding saved without network access.",
		);
	}
	/** Configuration entry used by composition, never by Subscriptions. No I/O or writes. */
	rssReference(input: string): SourceReference {
		return this.rss.createReference(input);
	}
	jackettReference(input: JackettPlan): SourceReference {
		this.context.open();
		if (!this.options.jackett) throw new SourceError("source_unconfigured");
		const plan = this.options.jackett.plan(input);
		const id = createHash("sha256")
			.update(
				JSON.stringify([
					"jackett",
					plan.generation,
					plan.indexerId,
					plan.titles,
				]),
			)
			.digest("hex");
		const reference = Object.freeze({ id });
		this.references.set(reference, plan);
		return reference;
	}
	private refreshQuery(
		reference: SourceReference,
		plan: JackettPlan,
	): Promise<SourceRecord> {
		const pending = this.searching.get(reference.id);
		if (pending) return pending;
		if (this.searching.size >= 2)
			return Promise.reject(new SourceError("source_busy"));
		const previousRevision =
			this.options.store.source(reference.id)?.snapshot?.revision ?? null;
		const task = (async () => {
			if (!this.options.jackett) throw new SourceError("source_unconfigured");
			const result = await this.options.jackett.search(plan);
			this.context.open();
			if (!this.options.jackett.current(plan.generation))
				throw new SourceError("source_conflict");
			const snapshot: SourceRecord = Object.freeze({
				id: reference.id,
				revision: randomUUID(),
				label: plan.indexerId,
				entries: Object.freeze(
					result.entries.map((entry) =>
						Object.freeze({
							...entry,
							generation: plan.generation,
							download: entry.download ? Object.freeze(entry.download) : null,
						}),
					),
				),
				checkedAt: this.context.now(),
				nextAttemptAt: this.context.now() + this.context.refreshIntervalMs(),
				error: null,
				coverage: Object.freeze(result.coverage),
				outcome: result.outcome,
			});
			this.queryResults.set(snapshot, { plan, previousRevision });
			return snapshot;
		})();
		this.searching.set(reference.id, task);
		void task
			.finally(() => this.searching.delete(reference.id))
			.catch(() => {});
		return task;
	}
	reference(id: string): SourceReference {
		this.context.open();
		const source = this.options.store.source(id);
		return source?.binding.kind === "jackett"
			? this.jackettReference(source.binding.plan)
			: source?.binding.kind === "rss"
				? this.rss.createReference(source.binding.url)
				: this.rss.reference(id);
	}
	private async prepare(reference: SourceReference) {
		this.context.open();
		const plan = this.references.get(reference);
		return plan
			? this.refreshQuery(reference, plan)
			: this.rss.refresh(reference);
	}
	private current(result: SourceRecord) {
		const prepared = this.queryResults.get(result);
		if (prepared)
			return (
				!this.context.signal.aborted &&
				Boolean(this.options.jackett?.current(prepared.plan.generation)) &&
				((this.options.store.source(result.id)?.snapshot?.revision ?? null) ===
					prepared.previousRevision ||
					this.options.store.source(result.id)?.snapshot?.revision ===
						result.revision)
			);
		return this.rss.isCurrent(result);
	}
	private publishRecord(result: SourceRecord) {
		this.context.open();
		const prepared = this.queryResults.get(result);
		if (prepared) {
			if (!this.current(result)) throw new SourceError("source_conflict");
			const previous = this.options.store.source(result.id);
			this.options.store.saveSource({
				id: result.id,
				binding: { kind: "jackett", plan: prepared.plan },
				enabled: previous?.enabled ?? false,
				failures: 0,
				snapshot: structuredClone(result),
			});
			this.options.logger.debug(
				{
					event: "acquisition.source_published",
					sourceId: result.id,
					revision: result.revision,
				},
				"Query evidence published without download authorization.",
			);
			return;
		}
		this.rss.publish(result);
		const previous = this.options.store.source(result.id);
		const feed = this.options.rss.store.feed(result.id);
		if (!feed) throw new SourceError("source_missing");
		this.options.store.saveSource({
			id: result.id,
			binding: { kind: "rss", url: feed.url },
			enabled: previous?.enabled ?? false,
			failures: 0,
			snapshot: null,
		});
	}
	private recordFailed(previous: SourceRecord, code: string, retryAt?: number) {
		if (this.context.signal.aborted) return;
		const source = this.options.store.source(previous.id);
		if (
			source &&
			(source.binding.kind === "jackett" ||
				!this.options.rss.store.feed(previous.id))
		) {
			if (source.snapshot?.revision !== previous.revision) return;
			const failures = source.failures + 1;
			this.options.store.saveSource({
				...source,
				failures,
				snapshot: {
					...source.snapshot,
					revision: randomUUID(),
					error: code,
					nextAttemptAt: this.context.retryAt(failures, retryAt),
				},
			});
			this.options.logger.warn(
				{ event: "acquisition.source_retry", sourceId: previous.id, code },
				"Source refresh failed; previous evidence retained.",
			);
			return;
		}
		this.rss.failed(previous, code, retryAt);
	}
	start(
		activeIds: () => string[],
		poll: (source: SourceSnapshot) => Promise<void>,
	) {
		this.context.open();
		if (this.scheduler) return;
		this.scheduler = new SourceScheduler(
			this.context,
			this.options.logger,
			activeIds,
			(id) => {
				const source = this.options.store.source(id);
				const snapshot = this.record(id);
				if (!source && !snapshot) return null;
				if (
					source?.binding.kind === "jackett" &&
					!this.options.jackett?.current(source.binding.plan.generation)
				)
					return null;
				const failures =
					source?.binding.kind === "jackett"
						? source.failures
						: (this.options.rss.store.feed(id)?.failures ?? source?.failures);
				if (!snapshot) return { id, nextAttemptAt: 0 };
				const nextAttemptAt =
					failures || snapshot.checkedAt === null
						? snapshot.nextAttemptAt
						: snapshot.checkedAt + this.context.refreshIntervalMs();
				if (nextAttemptAt !== snapshot.nextAttemptAt) {
					if (source?.binding.kind === "jackett")
						this.options.store.saveSource({
							...source,
							snapshot: { ...snapshot, nextAttemptAt },
						});
					else {
						const feed = this.options.rss.store.feed(id);
						if (feed)
							this.options.rss.store.saveFeed({ ...feed, nextAttemptAt });
					}
				}
				return { id, nextAttemptAt };
			},
			async (id) => {
				const snapshot = this.snapshot(id);
				if (snapshot) await poll(snapshot);
			},
		);
		this.scheduler.start();
	}
	close() {
		this.closing ??= (async () => {
			this.context.shutdown.abort();
			try {
				await Promise.allSettled([
					this.rss.close(),
					this.downloads.close(),
					this.scheduler?.close(),
					this.options.jackett?.close(),
				]);
			} finally {
				await Promise.allSettled(this.searching.values());
			}
		})();
		return this.closing;
	}
}
