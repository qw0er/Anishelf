import { createHash, randomUUID } from "node:crypto";
import type { SourceRead } from "../adapter.js";
import type { SourceContext } from "../context.js";
import {
	type FeedRecord,
	SourceError,
	type SourceRecord,
} from "../domain/model.js";
import type { SourceReference } from "../domain/reference.js";
import type { SourceLifecycleStore } from "../lifecycle.js";
import { FeedReader } from "./feed-reader.js";
import type { RssSourceOptions } from "./ports.js";

export class RssSource {
	private readonly reader: FeedReader;
	private readonly references = new WeakMap<
		SourceReference,
		{ url: string; persisted: boolean }
	>();
	constructor(
		private readonly context: SourceContext,
		private readonly options: RssSourceOptions,
		private readonly store: SourceLifecycleStore,
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
	async refresh(reference: SourceReference): Promise<SourceRead> {
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
		);
		this.context.open();
		const result = this.project(feed);

		this.options.logger.debug(
			{
				event: "acquisition.source_prepared",
				sourceId: feed.id,
				revision: feed.revision,
				entries: feed.entries.length,
			},
			"RSS evidence prepared without publication.",
		);
		return {
			record: result,
			generation: null,
			valid: () => !this.context.signal.aborted,
			persist: () => {
				this.options.store.saveFeed(feed);
				const previous = this.store.source(result.id);
				this.store.saveSource({
					id: result.id,
					binding: { kind: "rss", url: binding.url },
					enabled: previous?.enabled ?? false,
					failures: 0,
					snapshot: null,
				});
			},
		};
	}
	close() {
		return this.options.transport.close();
	}
}
