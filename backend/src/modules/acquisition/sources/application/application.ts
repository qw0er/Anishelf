import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { SourceRead } from "../domain/adapter.js";
import { SourceError } from "../domain/model.js";
import type { SourceReference } from "../domain/reference.js";
import { SourceEvidence } from "../infrastructure/evidence.js";
import type { SourceLifecycleStore } from "../infrastructure/store.js";
import { JackettSource } from "../jackett/application.js";
import type { JackettConnection } from "../jackett/connection.js";
import type {
	SourceFetchOptions,
	SourceInput,
	SourcePublication,
	SourceSnapshot,
} from "../public.js";
import { RssSource } from "../rss/application.js";
import type { RssSourceOptions } from "../rss/ports.js";
import { RssTransport } from "../rss/transport.js";
import { SourceContent, type SourceTorrentTransport } from "./content.js";
import { SourceContext } from "./context.js";
import { SourceScheduler } from "./scheduler.js";

/** Consumer cancellation/assessment failure must not be recorded as upstream health. */
class SourceDecisionError extends Error {
	constructor(readonly decisionError: unknown) {
		super("Source consumer evaluation failed.");
	}
}

export interface SourcesApplicationOptions {
	rss: RssSourceOptions;
	store: SourceLifecycleStore;
	torrentTransport?: SourceTorrentTransport;
	jackett?: JackettConnection;
	logger: Logger;
	now?: () => number;
	refreshIntervalMinutes?: () => number | undefined;
}

/** Private implementation. Consumers receive the unified API from createSourcesModule. */
export class SourcesApplication {
	private readonly context: SourceContext;
	private readonly rss: RssSource;
	private readonly query: JackettSource;
	private readonly downloads: SourceContent;
	private readonly evidence: SourceEvidence;
	private readonly prepared = new WeakMap<
		SourceSnapshot,
		{ read: SourceRead; previousRevision: string | null }
	>();
	private readonly fetching = new Map<string, Promise<SourceSnapshot>>();
	private readonly reusable = new Map<
		string,
		{ read: SourceRead; previousRevision: string | null }
	>();
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
		this.downloads = new SourceContent(
			options.store,
			options.torrentTransport ?? new RssTransport(),
			options.jackett,
			this.context.signal,
			options.logger,
			(id) => this.evidence.read(id),
			() => this.context.now(),
		);
	}
	snapshot(input: SourceInput | string): SourceSnapshot | null {
		const reference =
			typeof input === "string" ? null : this.referenceFor(input);
		const record = this.evidence.read(reference?.id ?? (input as string));
		return record
			? this.project(record)
			: reference
				? this.pending(reference)
				: null;
	}
	private pending(reference: SourceReference): SourceSnapshot {
		const plan = this.query.plan(reference);
		return Object.freeze({
			id: reference.id,
			revision: `pending:${reference.id}`,
			label: plan
				? plan.indexerId
				: new URL(this.rss.configuration(reference)).origin,
			entries: Object.freeze([]),
			checkedAt: null,
			nextAttemptAt: 0,
			error: null,
		});
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
	private prepare(
		read: SourceRead,
		previousRevision = this.evidence.read(read.record.id)?.revision ?? null,
	): SourceSnapshot {
		const result = this.project(read.record);
		this.prepared.set(result, { read, previousRevision });
		return result;
	}
	private usable(record: SourceRead["record"], options: SourceFetchOptions) {
		const age = record.entries.length
			? this.context.refreshIntervalMs()
			: Math.min(this.context.refreshIntervalMs(), 5 * 60_000);
		if (
			record.checkedAt === null ||
			record.error ||
			record.checkedAt + age <= this.context.now()
		)
			return false;
		return (
			record.coverage?.reason !== "accepted" ||
			Boolean(options.accept?.(this.project(record)))
		);
	}
	private remember(read: SourceRead, previousRevision: string | null) {
		this.reusable.delete(read.record.id);
		this.reusable.set(read.record.id, { read, previousRevision });
		let entries = [...this.reusable.values()].reduce(
			(count, value) => count + value.read.record.entries.length,
			0,
		);
		while (this.reusable.size > 64 || entries > 10_000) {
			const first = this.reusable.entries().next().value;
			if (!first) break;
			this.reusable.delete(first[0]);
			entries -= first[1].read.record.entries.length;
		}
	}
	/** Collection cache never grants permission: every consumer must still commit its own candidate transaction. */
	async collect(
		reference: SourceReference,
		options: SourceFetchOptions = {},
	): Promise<SourceSnapshot> {
		this.context.open();
		const plan = this.query.plan(reference);
		if (!plan) this.rss.configuration(reference);
		const saved = this.evidence.read(reference.id);
		if (saved?.error && saved.nextAttemptAt > this.context.now())
			throw new SourceError(saved.error, saved.nextAttemptAt);
		const cached = this.reusable.get(reference.id);
		const cachedCurrent =
			cached &&
			(saved?.revision === cached.previousRevision ||
				saved?.revision === cached.read.record.revision ||
				(cached.previousRevision === null &&
					(!saved || (saved.checkedAt === null && !saved.error))));
		const cachedUsable =
			cachedCurrent &&
			cached.read.valid() &&
			this.usable(cached.read.record, options);
		if (
			cached &&
			cachedUsable &&
			(cached.read.record.checkedAt ?? 0) >= (saved?.checkedAt ?? 0)
		) {
			this.options.logger.debug(
				{
					event: "acquisition.source_cache_hit",
					sourceId: reference.id,
					prepared: true,
				},
				"Prepared source evidence reused.",
			);
			return this.prepare(cached.read);
		}
		if (cached && !cachedUsable) this.reusable.delete(reference.id);
		if (saved && this.usable(saved, options)) {
			const read: SourceRead = {
				record: saved,
				generation: plan?.generation ?? null,
				valid: () =>
					!this.context.signal.aborted &&
					(!plan || this.query.current(plan.generation)) &&
					this.evidence.read(saved.id)?.revision === saved.revision,
				persist: () => {},
			};
			this.options.logger.debug(
				{
					event: "acquisition.source_cache_hit",
					sourceId: reference.id,
					prepared: false,
				},
				"Published source evidence reused.",
			);
			return this.prepare(read);
		}
		return this.refresh(reference, options);
	}
	async refresh(
		reference: SourceReference,
		options: SourceFetchOptions = {},
	): Promise<SourceSnapshot> {
		this.context.open();
		// Validate provenance before coalescing: another instance cannot borrow an in-flight reference.
		const query = Boolean(this.query.plan(reference));
		if (!query) this.rss.configuration(reference);
		const current = this.fetching.get(reference.id);
		if (current) {
			let result: SourceSnapshot;
			try {
				result = await current;
			} catch (error) {
				// A caller's acceptance/identity decision cannot fail another consumer.
				if (error instanceof SourceDecisionError)
					return this.refresh(reference, options);
				throw error;
			}
			if (result.coverage?.reason !== "accepted" || options.accept?.(result))
				return result;
			return this.refresh(reference, options);
		}
		if (this.fetching.size >= 32) throw new SourceError("source_busy");
		const previousRevision = this.evidence.read(reference.id)?.revision ?? null;
		const task = (async () => {
			const read = await (query
				? this.query.refresh(
						reference,
						options.accept
							? (record) => options.accept?.(this.project(record)) ?? false
							: undefined,
					)
				: this.rss.refresh(reference));
			this.context.open();
			this.remember(read, previousRevision);
			return this.prepare(read, previousRevision);
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
	async fetch(
		input: SourceInput | string,
		options: SourceFetchOptions = {},
	): Promise<SourcePublication> {
		const reference =
			typeof input === "string"
				? this.reference(input)
				: this.referenceFor(input);
		// Register private cache/backoff state on demand; callers never register sources.
		this.bind(reference);
		const previous = this.snapshot(reference.id);
		try {
			const result = await this.collect(
				reference,
				options.accept
					? {
							accept: (snapshot) => {
								try {
									return options.accept?.(snapshot) ?? false;
								} catch (error) {
									throw new SourceDecisionError(error);
								}
							},
						}
					: options,
			);
			return Object.freeze({
				snapshot: result,
				commit: (writeCandidates: () => void) =>
					this.publish(result, writeCandidates),
			});
		} catch (error) {
			if (error instanceof SourceDecisionError) throw error.decisionError;
			if (
				previous &&
				!this.context.signal.aborted &&
				!(
					error instanceof SourceError &&
					["source_conflict", "source_busy", "request_cancelled"].includes(
						error.code,
					)
				) &&
				!(previous.error && previous.nextAttemptAt > this.context.now())
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
					: (this.evidence.due(id) ?? { id, nextAttemptAt: 0 });
			},
			async (id) => {
				const snapshot = this.snapshot(id);
				await poll(
					snapshot ?? {
						id,
						revision: `pending:${id}`,
						label: "",
						entries: [],
						checkedAt: null,
						nextAttemptAt: 0,
						error: null,
					},
				);
			},
		);
		this.scheduler.start();
	}
	close() {
		this.closing ??= (async () => {
			this.context.shutdown.abort();
			this.reusable.clear();
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
