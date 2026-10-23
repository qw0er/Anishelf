import { randomUUID } from "node:crypto";
import type { SourceContext } from "../context.js";
import type { SourceRecord } from "../domain/model.js";
import type { SourceLifecycleStore } from "../lifecycle.js";
import type { SourceStore } from "../rss/ports.js";

/** Normalizes existing protocol storage behind one evidence-state owner. */
export class SourceEvidence {
	constructor(
		private readonly store: SourceLifecycleStore,
		private readonly feeds: SourceStore,
		private readonly context: SourceContext,
	) {}
	read(id: string): SourceRecord | null {
		const source = this.store.source(id);
		const feed =
			source?.binding.kind === "jackett" ? null : this.feeds.feed(id);
		return feed
			? {
					id: feed.id,
					revision: feed.revision,
					label: new URL(feed.url).origin,
					entries: feed.entries,
					checkedAt: feed.checkedAt,
					nextAttemptAt: feed.nextAttemptAt,
					error: feed.error,
				}
			: (source?.snapshot ?? null);
	}
	generation(id: string) {
		const binding = this.store.source(id)?.binding;
		return binding?.kind === "jackett" ? binding.plan.generation : null;
	}
	failed(
		previous: Pick<SourceRecord, "id" | "revision">,
		code: string,
		retryAt?: number,
	) {
		if (
			this.context.signal.aborted ||
			this.read(previous.id)?.revision !== previous.revision
		)
			return;
		const source = this.store.source(previous.id);
		const feed =
			source?.binding.kind === "jackett" ? null : this.feeds.feed(previous.id);
		const failures = (feed?.failures ?? source?.failures ?? 0) + 1;
		const update = {
			revision: randomUUID(),
			error: code,
			nextAttemptAt: this.context.retryAt(failures, retryAt),
		};
		if (feed) this.feeds.saveFeed({ ...feed, ...update, failures });
		else if (source?.snapshot)
			this.store.saveSource({
				...source,
				failures,
				snapshot: { ...source.snapshot, ...update },
			});
		this.context.options.logger.warn(
			{ event: "acquisition.source_retry", sourceId: previous.id, code },
			"Source refresh failed; previous evidence retained.",
		);
	}
	due(id: string) {
		const snapshot = this.read(id);
		if (!snapshot) return null;
		const source = this.store.source(id);
		const feed =
			source?.binding.kind === "jackett" ? null : this.feeds.feed(id);
		const failures = feed?.failures ?? source?.failures ?? 0;
		const nextAttemptAt =
			failures || snapshot.checkedAt === null
				? snapshot.nextAttemptAt
				: snapshot.checkedAt + this.context.refreshIntervalMs();
		if (nextAttemptAt !== snapshot.nextAttemptAt) {
			if (feed) this.feeds.saveFeed({ ...feed, nextAttemptAt });
			else if (source)
				this.store.saveSource({
					...source,
					snapshot: { ...snapshot, nextAttemptAt },
				});
		}
		return { id, nextAttemptAt };
	}
}
