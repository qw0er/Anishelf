import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { ReleaseAssessmentApi } from "../../../anime/public.js";
import type { SourcesApi } from "../../sources/public.js";
import type { AcquisitionProfile } from "../domain/profiles.js";
import type { SubscriptionStore } from "../ports.js";
export type SubscriptionsOptions = {
	profiles?: readonly AcquisitionProfile[];
	defaultProfileId?: () => string | undefined;
	lockedCandidates?: (workKey: string) => string[];
	store: SubscriptionStore;
	sources: SourcesApi;
	anime: ReleaseAssessmentApi;
	downloads: (signal: AbortSignal) => Promise<string[] | null>;
	logger: Logger;
	now?: () => number;
	/** Read-only configuration stamp, not a dependency on the Downloads application. */
	downloadTarget?: () => {
		revision: string;
		connectionGeneration: string;
		validated: boolean;
	} | null;
};
export class SubscriptionsContext {
	readonly shutdown = new AbortController();
	readonly pending = new Set<Promise<unknown>>();
	constructor(readonly options: SubscriptionsOptions) {}
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
				"Subscriptions are stopping.",
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
