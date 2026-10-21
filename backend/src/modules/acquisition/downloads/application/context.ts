import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { QbittorrentApi } from "../../qbittorrent/public.js";
import type { DownloadIntent } from "../domain/model.js";
import type { DownloadStore, TorrentTransport } from "../ports.js";
import { downloadPolicy as policy } from "./policy.js";

export function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Acquisition settings or scope changed. Preview again.",
	);
}
export interface DownloadOptions {
	store: Pick<DownloadStore, "intent" | "saveIntent" | "hashOwner">;
	transport: TorrentTransport;
	connectionGeneration(): string;
	withClient<T>(
		generation: string,
		operation: (client: QbittorrentApi) => Promise<T>,
	): Promise<T>;
	logger: Logger;
	now?: () => number;
}
/** Shared lifetime and the only revision-checked intent writer. */
export class DownloadContext {
	readonly shutdown = new AbortController();
	readonly pending = new Set<Promise<unknown>>();
	constructor(readonly options: DownloadOptions) {}
	get signal(): AbortSignal {
		return this.shutdown.signal;
	}
	now() {
		return this.options.now?.() ?? Date.now();
	}
	open() {
		if (this.shutdown.signal.aborted)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Acquisition is stopping.",
			);
	}
	tracked<T>(operation: () => Promise<T>) {
		this.open();
		const task = operation();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	save(item: DownloadIntent) {
		this.open();
		const current = this.options.store.intent(item.id);
		if (!current || current.revision !== item.revision) conflict();
		if (
			JSON.stringify({ ...current, revision: "", updatedAt: 0 }) ===
			JSON.stringify({ ...item, revision: "", updatedAt: 0 })
		)
			return current;
		const value = { ...item, revision: randomUUID(), updatedAt: this.now() };
		this.options.store.saveIntent(value);
		if (
			current.state !== item.state ||
			current.ingestion !== item.ingestion ||
			current.error !== item.error
		)
			this.options.logger.info(
				{
					event: "acquisition.intent_state",
					intentId: item.id,
					workKey: item.workKey,
					revision: value.revision,
					state: item.state,
					ingestion: item.ingestion,
					code: item.error,
				},
				"Acquisition state updated.",
			);
		return value;
	}
	delay(attempts: number) {
		return Math.min(policy.retryMaximumMs, 30_000 * 2 ** Math.min(attempts, 7));
	}
}

/** Retains our last write across stages without adopting concurrent user commands. */
export class DownloadExecution {
	constructor(
		private readonly context: DownloadContext,
		public current: DownloadIntent,
	) {}
	save(value: DownloadIntent) {
		this.current = this.context.save(value);
		return this.current;
	}
}
