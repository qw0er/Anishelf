import type { Logger } from "pino";
import { rssConstraints } from "../../../../contracts/defaults.js";
import { DomainError } from "../../../../shared/errors.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
} from "../../../anime/public.js";
import type { FeedRecord, Subscription } from "../domain/model.js";
import type { DiscoveryStore, FeedTransport } from "../ports.js";
export type DiscoveryOptions = {
	store: DiscoveryStore;
	transport: FeedTransport;
	anime: ReleaseAssessmentApi;
	parse: (xml: string) => FeedRecord["entries"];
	normalizeUrl: (url: string) => string;
	downloads: (signal: AbortSignal) => Promise<string[] | null>;
	logger: Logger;
	now?: () => number;
	refreshIntervalMinutes?: () => number | undefined;
	downloadPreview?: (
		key: string,
		target: AcquisitionTarget,
	) => { revision: string; path: string } | null;
	confirmation: {
		commit(
			subscription: Subscription,
			destinationRevision: string | null,
			persist: () => void,
		): void;
	};
};
export class DiscoveryContext {
	readonly shutdown = new AbortController();
	readonly pending = new Set<Promise<unknown>>();
	constructor(readonly options: DiscoveryOptions) {}
	get signal(): AbortSignal {
		return this.shutdown.signal;
	}
	refreshIntervalMs() {
		return (
			(this.options.refreshIntervalMinutes?.() ??
				rssConstraints.defaultRefreshIntervalMinutes) * 60_000
		);
	}
	now() {
		return this.options.now?.() ?? Date.now();
	}
	open() {
		if (this.shutdown.signal.aborted)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Discovery is stopping.",
			);
	}
	tracked<T>(operation: () => Promise<T>): Promise<T> {
		this.open();
		const task = operation();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
}
