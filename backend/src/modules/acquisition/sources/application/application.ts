import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { SourceContext } from "../context.js";
import { SourceError } from "../domain/model.js";
import type { JackettConnection } from "../jackett/connection.js";
import type { JackettPlan } from "../jackett/model.js";
import type { SourceReference, SourceSnapshot, SourcesApi } from "../public.js";
import { RssSource, type RssSourceOptions } from "../rss/public.js";

export interface SourcesApplicationOptions {
	rss: RssSourceOptions;
	jackett?: JackettConnection;
	logger: Logger;
	now?: () => number;
	refreshIntervalMinutes?: () => number | undefined;
}

export class SourcesApplication implements SourcesApi {
	private readonly context: SourceContext;
	private readonly rss: RssSource;
	private readonly references = new WeakMap<SourceReference, JackettPlan>();
	private readonly queryResults = new WeakMap<SourceSnapshot, string>();
	private readonly searching = new Map<string, Promise<SourceSnapshot>>();
	private closing: Promise<void> | undefined;
	constructor(private readonly options: SourcesApplicationOptions) {
		this.context = new SourceContext(options);
		this.rss = new RssSource(this.context, options.rss);
	}
	snapshot(id: string) {
		return this.rss.snapshot(id);
	}
	/** Configuration entry used by composition, never by Discovery. No I/O or writes. */
	rssReference(input: string): SourceReference {
		return this.rss.createReference(input);
	}
	jackettReference(input: JackettPlan): SourceReference {
		this.context.open();
		if (!this.options.jackett) throw new SourceError("source_unconfigured");
		const plan = this.options.jackett.plan(input);
		const id = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
		const reference = Object.freeze({ id });
		this.references.set(reference, plan);
		return reference;
	}
	private refreshQuery(
		reference: SourceReference,
		plan: JackettPlan,
	): Promise<SourceSnapshot> {
		const pending = this.searching.get(reference.id);
		if (pending) return pending;
		if (this.searching.size >= 2)
			return Promise.reject(new SourceError("source_busy"));
		const task = (async () => {
			if (!this.options.jackett) throw new SourceError("source_unconfigured");
			const result = await this.options.jackett.search(plan);
			this.context.open();
			if (!this.options.jackett.current(plan.generation))
				throw new SourceError("source_conflict");
			const snapshot: SourceSnapshot = Object.freeze({
				id: reference.id,
				revision: randomUUID(),
				label: plan.indexerId,
				entries: Object.freeze(
					result.entries.map((entry) =>
						Object.freeze({
							...entry,
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
			this.queryResults.set(snapshot, plan.generation);
			return snapshot;
		})();
		this.searching.set(reference.id, task);
		void task
			.finally(() => this.searching.delete(reference.id))
			.catch(() => {});
		return task;
	}
	reference(id: string): SourceReference {
		return this.rss.reference(id);
	}
	refresh(reference: SourceReference) {
		this.context.open();
		const plan = this.references.get(reference);
		return plan
			? this.refreshQuery(reference, plan)
			: this.rss.refresh(reference);
	}
	isCurrent(result: SourceSnapshot) {
		const generation = this.queryResults.get(result);
		if (generation)
			return (
				!this.context.signal.aborted &&
				Boolean(this.options.jackett?.current(generation))
			);
		return this.rss.isCurrent(result);
	}
	publish(result: SourceSnapshot) {
		this.context.open();
		// Query bindings and permissions migrate together in the manual subscription stage.
		if (this.queryResults.has(result))
			throw new SourceError("query_subscription_unavailable");
		this.rss.publish(result);
	}
	failed(previous: SourceSnapshot, code: string) {
		this.rss.failed(previous, code);
	}
	start(
		activeIds: () => string[],
		poll: (source: SourceSnapshot) => Promise<void>,
	) {
		this.context.open();
		this.rss.start(activeIds, poll);
	}
	close() {
		this.closing ??= (async () => {
			this.context.shutdown.abort();
			try {
				await Promise.allSettled([
					this.rss.close(),
					this.options.jackett?.close(),
				]);
			} finally {
				await Promise.allSettled(this.searching.values());
			}
		})();
		return this.closing;
	}
}
