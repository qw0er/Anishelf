import { workKey } from "@anishelf/contracts/references";
import PQueue from "p-queue";
import type { Logger } from "pino";
import { metadataDefaults } from "../defaults.js";
import {
	type CachedMetadata,
	preferredWorkTitle,
	type TitleDisplayPreference,
	type WorkDetails,
} from "../domain/model.js";
import type { ProviderReference } from "../domain/source-model.js";
import type { MetadataStore } from "../ports.js";
import type { MetadataLibraryTitlesApi } from "../public.js";

/** Cached reads are synchronous; only visible missing titles enter the bounded queue. */
export class MetadataLibraryTitles implements MetadataLibraryTitlesApi {
	private readonly queue = new PQueue({ concurrency: 1 });
	private readonly pending = new Set<string>();
	private readonly retryAt = new Map<string, number>();
	private readonly controller = new AbortController();
	constructor(
		private readonly options: {
			store: Pick<MetadataStore, "titles">;
			load: (
				reference: ProviderReference,
				signal: AbortSignal,
			) => Promise<CachedMetadata<WorkDetails>>;
			logger?: Logger;
			now?: () => number;
		},
	) {}
	cached(references: readonly ProviderReference[]) {
		return this.options.store.titles(references);
	}
	request(
		references: readonly ProviderReference[],
		preference: TitleDisplayPreference,
	): boolean {
		if (this.controller.signal.aborted) return false;
		const titles = this.cached(references);
		let waitingForCapacity = false;
		let scheduled = 0;
		for (const reference of references) {
			const key = workKey(reference);
			if (preferredWorkTitle(titles.get(key) ?? [], preference)) continue;
			if (this.pending.has(key)) continue;
			const attemptKey = `${key}/${preference}`;
			if ((this.retryAt.get(attemptKey) ?? 0) > this.now()) continue;
			if (this.pending.size >= metadataDefaults.titleMaximumPending) {
				waitingForCapacity = true;
				break;
			}
			this.pending.add(key);
			scheduled++;
			void this.queue
				.add(async () => {
					const started = this.now();
					this.options.logger?.debug(
						{
							event: "metadata.library_titles_started",
							provider: reference.provider,
							providerId: reference.id,
							preference,
							pending: this.pending.size,
						},
						"Visible work title lookup started.",
					);
					try {
						const signal = AbortSignal.any([
							this.controller.signal,
							AbortSignal.timeout(metadataDefaults.titleRequestTimeoutMs),
						]);
						const value = await this.options.load(reference, signal);
						signal.throwIfAborted();
						const complete = Boolean(
							preferredWorkTitle(value.data.titles, preference),
						);
						this.cooldown(attemptKey, metadataDefaults.titleMissingRetryMs);
						this.options.logger?.debug(
							{
								event: "metadata.library_titles_completed",
								provider: reference.provider,
								providerId: reference.id,
								preference,
								complete,
								durationMs: this.now() - started,
							},
							"Visible work title lookup completed.",
						);
					} catch (error) {
						this.cooldown(attemptKey, metadataDefaults.titleFailureRetryMs);
						this.options.logger?.debug(
							{
								event: "metadata.library_titles_failed",
								provider: reference.provider,
								providerId: reference.id,
								preference,
								err: error,
								durationMs: this.now() - started,
							},
							"Visible work title lookup failed; cached titles remain available.",
						);
					} finally {
						this.pending.delete(key);
					}
				})
				.catch((error: unknown) => {
					this.pending.delete(key);
					this.options.logger?.error(
						{ event: "metadata.library_titles_queue_failed", err: error },
						"Title lookup queue failed.",
					);
				});
		}
		if (scheduled)
			this.options.logger?.debug(
				{
					event: "metadata.library_titles_scheduled",
					preference,
					scheduled,
					pending: this.pending.size,
				},
				"Visible work title enrichment scheduled.",
			);
		return (
			waitingForCapacity ||
			references.some((reference) => this.pending.has(workKey(reference)))
		);
	}
	private now() {
		return (this.options.now ?? Date.now)();
	}
	private cooldown(key: string, duration: number) {
		if (this.retryAt.size >= 1000) {
			for (const [entry, until] of this.retryAt)
				if (until <= this.now()) this.retryAt.delete(entry);
			if (this.retryAt.size >= 1000)
				this.retryAt.delete(this.retryAt.keys().next().value ?? "");
		}
		this.retryAt.set(key, this.now() + duration);
	}
	async close(): Promise<void> {
		this.controller.abort();
		this.queue.clear();
		await this.queue.onIdle();
		this.pending.clear();
	}
}
