import { createHash, randomUUID } from "node:crypto";
import { type FeedRecord, SourceError } from "../domain/model.js";
import { sourcePolicy as policy } from "../policy.js";
import type { SourceRequest, SourceSnapshot, SourcesApi } from "../public.js";
import { SourceContext, type SourceOptions } from "./context.js";
import { FeedReader } from "./feed-reader.js";
import { SourceScheduler } from "./scheduler.js";

export class SourcesApplication implements SourcesApi {
	private readonly context: SourceContext;
	private readonly reader: FeedReader;
	private readonly prepared = new WeakMap<
		SourceSnapshot,
		{
			feed: FeedRecord;
			previousRevision: string | null;
		}
	>();
	private scheduler: SourceScheduler | undefined;
	private closing: Promise<void> | undefined;
	constructor(private readonly options: SourceOptions) {
		this.context = new SourceContext(options);
		this.reader = new FeedReader(this.context);
	}
	private project(feed: FeedRecord): SourceSnapshot {
		return Object.freeze({
			id: feed.id,
			revision: feed.revision,
			label: new URL(feed.url).origin,
			entries: Object.freeze(
				structuredClone(feed.entries).map((entry) => Object.freeze(entry)),
			),
			checkedAt: feed.checkedAt,
			nextAttemptAt: feed.nextAttemptAt,
			error: feed.error,
		});
	}
	snapshot(id: string) {
		const feed = this.options.store.feed(id);
		return feed ? this.project(feed) : null;
	}
	async read(request: SourceRequest) {
		this.context.open();
		if (request.kind === "query")
			throw new SourceError("unsupported_capability");
		let url: string;
		try {
			url = this.options.normalizeUrl(request.url);
		} catch {
			throw new SourceError("invalid_source_url");
		}
		const id = createHash("sha256").update(url).digest("hex");
		const existing = this.options.store.feed(id);
		return this.prepare(
			existing ?? {
				id,
				revision: randomUUID(),
				url,
				etag: null,
				lastModified: null,
				entries: [],
				checkedAt: null,
				nextAttemptAt: 0,
				failures: 0,
				error: null,
			},
			existing?.revision ?? null,
		);
	}
	async refresh(id: string) {
		this.context.open();
		const feed = this.options.store.feed(id);
		if (!feed) throw new SourceError("source_missing");
		return this.prepare(feed, feed.revision);
	}
	private async prepare(feed: FeedRecord, previousRevision: string | null) {
		const prepared = await this.reader.fetch(feed, previousRevision);
		const updated = prepared.feed;
		this.context.open();
		const result = this.project(updated);
		this.prepared.set(result, prepared);
		this.options.logger.debug(
			{
				event: "acquisition.source_prepared",
				sourceId: feed.id,
				revision: updated.revision,
				entries: updated.entries.length,
			},
			"Source evidence prepared without publication.",
		);
		return result;
	}
	isCurrent(result: SourceSnapshot) {
		const prepared = this.prepared.get(result);
		if (!prepared || this.context.signal.aborted) return false;
		const current = this.options.store.feed(prepared.feed.id)?.revision ?? null;
		return (
			current === prepared.previousRevision ||
			current === prepared.feed.revision
		);
	}
	publish(result: SourceSnapshot) {
		this.context.open();
		const prepared = this.prepared.get(result);
		if (!prepared || !this.isCurrent(result)) {
			this.options.logger.debug(
				{ event: "acquisition.source_result_stale" },
				"Source evidence publication rejected.",
			);
			throw new SourceError("source_conflict");
		}
		this.options.store.saveFeed(prepared.feed);
	}
	failed(previous: SourceSnapshot, code: string) {
		if (this.context.signal.aborted) return;
		const feed = this.options.store.feed(previous.id);
		if (!feed || feed.revision !== previous.revision) return;
		const failures = feed.failures + 1;
		this.options.store.saveFeed({
			...feed,
			failures,
			error: code,
			nextAttemptAt:
				this.context.now() +
				Math.min(policy.retryMaximumMs, 60_000 * 2 ** Math.min(failures, 6)),
		});
	}
	start(
		activeIds: () => string[],
		poll: (source: SourceSnapshot) => Promise<void>,
	) {
		this.context.open();
		if (this.scheduler) return;
		this.scheduler = new SourceScheduler(this.context, activeIds, (feed) =>
			poll(this.project(feed)),
		);
		this.scheduler.start();
	}
	close() {
		this.closing ??= (async () => {
			this.context.shutdown.abort();
			try {
				await this.options.transport.close();
			} finally {
				await Promise.allSettled([
					this.reader.close(),
					this.scheduler?.close(),
				]);
			}
		})();
		return this.closing;
	}
}
