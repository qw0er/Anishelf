import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { SourceRead } from "../adapter.js";
import { SourceContext } from "../context.js";
import { SourceError } from "../domain/model.js";
import type { SourceReference } from "../domain/reference.js";
import { SourceDownloads, type SourceTorrentTransport } from "../downloads.js";
import { SourceEvidence } from "../infrastructure/evidence.js";
import type { SourceCollection, SourcePublication } from "../integration.js";
import { JackettSource } from "../jackett/application.js";
import type { JackettConnection } from "../jackett/connection.js";
import type { SourceLifecycleStore } from "../lifecycle.js";
import type { SourceInput, SourceSnapshot, SourcesApi } from "../public.js";
import { RssSource } from "../rss/application.js";
import type { RssSourceOptions } from "../rss/ports.js";
import { RssTransport } from "../rss/transport.js";
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

/** Private implementation. Consumers receive selected capabilities from createSourcesModule. */
export class SourcesApplication implements SourcesApi, SourceCollection {
	private readonly context: SourceContext;
	private readonly rss: RssSource;
	private readonly query: JackettSource;
	private readonly downloads: SourceDownloads;
	private readonly evidence: SourceEvidence;
	private readonly prepared = new WeakMap<
		SourceSnapshot,
		{ read: SourceRead; previousRevision: string | null }
	>();
	private readonly fetching = new Map<string, Promise<SourceSnapshot>>();
	private scheduler: SourceScheduler | undefined;
	private closing: Promise<void> | undefined;
	constructor(private readonly options: SourcesApplicationOptions) {
		this.context = new SourceContext(options);
		this.rss = new RssSource(this.context, options.rss, options.store);
		this.query = new JackettSource(
			this.context,
			options.store,
			options.jackett,
		);
		this.evidence = new SourceEvidence(
			options.store,
			options.rss.store,
			this.context,
		);
		this.downloads = new SourceDownloads(
			options.store,
			options.torrentTransport ?? new RssTransport(),
			options.jackett,
			this.context.signal,
			options.logger,
			(id) => this.evidence.read(id),
		);
	}
	snapshot(id: string): SourceSnapshot | null {
		const record = this.evidence.read(id);
		return record ? this.project(record) : null;
	}
	private project(record: SourceRead["record"]): SourceSnapshot {
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
	/** One configuration boundary for feeds and search bindings. No network I/O. */
	configure(input: SourceInput): string {
		const reference = this.referenceFor(input);
		this.bind(reference);
		return reference.id;
	}
	referenceFor(input: SourceInput): SourceReference {
		this.context.open();
		return input.kind === "feed"
			? this.rss.createReference(input.url)
			: this.query.reference({
					generation: input.connectionRevision,
					indexerId: input.providerId,
					titles: input.titles,
				});
	}
	bind(reference: SourceReference) {
		this.context.open();
		const plan = this.query.plan(reference);
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
	reference(id: string): SourceReference {
		this.context.open();
		const binding = this.options.store.source(id)?.binding;
		if (!binding) return this.rss.reference(id);
		return binding.kind === "rss"
			? this.rss.createReference(binding.url)
			: this.query.reference(binding.plan);
	}
	async refresh(reference: SourceReference): Promise<SourceSnapshot> {
		this.context.open();
		// Validate provenance before coalescing: another instance cannot borrow an in-flight reference.
		const query = Boolean(this.query.plan(reference));
		if (!query) this.rss.configuration(reference);
		const current = this.fetching.get(reference.id);
		if (current) return current;
		if (this.fetching.size >= 2) throw new SourceError("source_busy");
		const previousRevision = this.evidence.read(reference.id)?.revision ?? null;
		const task = (async () => {
			const read = await (query
				? this.query.refresh(reference)
				: this.rss.refresh(reference));
			this.context.open();
			const result = this.project(read.record);
			this.prepared.set(result, { read, previousRevision });
			return result;
		})();
		this.fetching.set(reference.id, task);
		void task.finally(() => this.fetching.delete(reference.id)).catch(() => {});
		return task;
	}
	isCurrent(result: SourceSnapshot) {
		const prepared = this.prepared.get(result);
		if (this.context.signal.aborted || !prepared || !prepared.read.valid())
			return false;
		const revision = this.evidence.read(result.id)?.revision ?? null;
		return (
			revision === prepared.previousRevision || revision === result.revision
		);
	}
	/** Private publication primitive; the collection capability supplies the shared transaction. */
	publish(result: SourceSnapshot, writeCandidates: () => void = () => {}) {
		this.context.open();
		const prepared = this.prepared.get(result);
		if (!prepared || !this.isCurrent(result))
			throw new SourceError("source_conflict");
		this.options.store.transaction(() => {
			if (!this.isCurrent(result)) throw new SourceError("source_conflict");
			prepared.read.persist();
			this.downloads.publish(prepared.read.record, prepared.read.generation);
			writeCandidates();
		});
		this.options.logger.debug(
			{
				event: "acquisition.source_published",
				sourceId: result.id,
				revision: result.revision,
			},
			"Source evidence published.",
		);
	}
	async collect(id: string): Promise<SourcePublication> {
		const previous = this.snapshot(id);
		try {
			const result = await this.refresh(this.reference(id));
			return Object.freeze({
				snapshot: result,
				commit: (writeCandidates: () => void) =>
					this.publish(result, writeCandidates),
			});
		} catch (error) {
			if (
				previous &&
				!this.context.signal.aborted &&
				!(error instanceof SourceError && error.code === "source_conflict")
			)
				this.evidence.failed(
					previous,
					error instanceof SourceError ? error.code : "upstream_failure",
					error instanceof SourceError ? error.retryAt : undefined,
				);
			throw error;
		}
	}
	readDownload(reference: string, signal: AbortSignal) {
		return this.downloads.read(reference, signal);
	}
	isDownloadCurrent(reference: string) {
		return this.downloads.isCurrent(reference);
	}
	start(
		activeIds: () => string[],
		poll: (snapshot: SourceSnapshot) => Promise<void>,
	) {
		this.context.open();
		if (this.scheduler) return;
		this.scheduler = new SourceScheduler(
			this.context,
			this.options.logger,
			activeIds,
			(id) => {
				const generation = this.evidence.generation(id);
				return generation && !this.query.current(generation)
					? null
					: this.evidence.due(id);
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
			await Promise.allSettled([
				this.rss.close(),
				this.downloads.close(),
				this.scheduler?.close(),
				this.query.close(),
			]);
			await Promise.allSettled(this.fetching.values());
		})();
		return this.closing;
	}
}
