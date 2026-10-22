import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
} from "../../../anime/public.js";
import type { SourcesApi } from "../../sources/public.js";
import type { Subscription } from "../domain/model.js";
import type { AcquisitionProfile } from "../domain/profiles.js";
import type { DiscoveryStore } from "../ports.js";
export type DiscoveryOptions = {
	profiles?: readonly AcquisitionProfile[];
	defaultProfileId?: () => string | undefined;
	lockedCandidates?: (workKey: string) => string[];
	store: DiscoveryStore;
	sources: SourcesApi;
	anime: ReleaseAssessmentApi;
	downloads: (signal: AbortSignal) => Promise<string[] | null>;
	logger: Logger;
	now?: () => number;
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
