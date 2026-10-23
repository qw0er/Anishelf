import { createHash, randomUUID } from "node:crypto";
import type { SourceContext } from "../context.js";
import {
	type FeedRecord,
	SourceError,
	type SourceRecord,
} from "../domain/model.js";
import type { SourceReference } from "../public.js";
import { FeedReader } from "./feed-reader.js";
import type { RssSourceOptions } from "./ports.js";

export class RssSource {
	private readonly reader: FeedReader;
	private readonly prepared = new WeakMap<
		SourceRecord,
		{ feed: FeedRecord; previousRevision: string | null }
	>();
	private readonly references = new WeakMap<
		SourceReference,
		{ url: string; persisted: boolean }
	>();
	constructor(
		private readonly context: SourceContext,
		private readonly options: RssSourceOptions,
	) {
		this.reader = new FeedReader(context, options);
	}
	private project(feed: FeedRecord): SourceRecord {
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
	createReference(input: string): SourceReference {
		this.context.open();
		let url: string;
		try {
			url = this.options.normalizeUrl(input);
		} catch {
			throw new SourceError("invalid_source_url");
		}
		const id = createHash("sha256").update(url).digest("hex");
		return this.bind(id, url, false);
	}
	reference(id: string): SourceReference {
		this.context.open();
		const feed = this.options.store.feed(id);
		if (!feed) throw new SourceError("source_missing");
		return this.bind(id, feed.url, true);
	}
	private bind(id: string, url: string, persisted: boolean): SourceReference {
		const reference = Object.freeze({ id });
		this.references.set(reference, { url, persisted });
		this.options.logger.debug(
			{
				event: "acquisition.source_reference_created",
				sourceId: id,
				persisted,
			},
			"RSS source reference prepared without exposing its URL.",
		);
		return reference;
	}
	configuration(reference: SourceReference) {
		const binding = this.references.get(reference);
		if (!binding) throw new SourceError("invalid_source_reference");
		return binding.url;
	}
	async refresh(reference: SourceReference) {
		this.context.open();
		const binding = this.references.get(reference);
		if (!binding) throw new SourceError("invalid_source_reference");
		const existing = this.options.store.feed(reference.id);
		if (!existing && binding.persisted) throw new SourceError("source_missing");
		const feed = await this.reader.fetch(
			existing ?? {
				id: reference.id,
				revision: randomUUID(),
				url: binding.url,
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
		this.context.open();
		const result = this.project(feed.feed);
		this.prepared.set(result, feed);
		this.options.logger.debug(
			{
				event: "acquisition.source_prepared",
				sourceId: feed.feed.id,
				revision: feed.feed.revision,
				entries: feed.feed.entries.length,
			},
			"RSS evidence prepared without publication.",
		);
		return result;
	}
	isCurrent(result: SourceRecord) {
		const prepared = this.prepared.get(result);
		if (!prepared || this.context.signal.aborted) return false;
		const current = this.options.store.feed(prepared.feed.id)?.revision ?? null;
		return (
			current === prepared.previousRevision ||
			current === prepared.feed.revision
		);
	}
	publish(result: SourceRecord) {
		this.context.open();
		const prepared = this.prepared.get(result);
		if (!prepared || !this.isCurrent(result)) {
			this.options.logger.debug(
				{ event: "acquisition.source_result_stale" },
				"RSS evidence publication rejected.",
			);
			throw new SourceError("source_conflict");
		}
		this.options.store.saveFeed(prepared.feed);
	}
	failed(previous: SourceRecord, code: string, retryAt?: number) {
		if (this.context.signal.aborted) return;
		const feed = this.options.store.feed(previous.id);
		if (!feed || feed.revision !== previous.revision) return;
		const failures = feed.failures + 1;
		this.options.store.saveFeed({
			...feed,
			revision: randomUUID(),
			failures,
			error: code,
			nextAttemptAt: this.context.retryAt(failures, retryAt),
		});
	}
	async close() {
		await Promise.allSettled([
			this.options.transport.close(),
			this.reader.close(),
		]);
	}
}
