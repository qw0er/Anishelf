import type { Logger } from "pino";
import { rssConstraints } from "../../../contracts/defaults.js";
import { DomainError } from "../../../shared/errors.js";
export interface SourceRuntimeOptions {
	logger: Logger;
	now?: () => number;
	refreshIntervalMinutes?: () => number | undefined;
}
export class SourceContext {
	readonly shutdown = new AbortController();
	constructor(readonly options: SourceRuntimeOptions) {}
	get signal(): AbortSignal {
		return this.shutdown.signal;
	}
	now() {
		return this.options.now?.() ?? Date.now();
	}
	refreshIntervalMs() {
		return (
			(this.options.refreshIntervalMinutes?.() ??
				rssConstraints.defaultRefreshIntervalMinutes) * 60_000
		);
	}
	open() {
		if (this.signal.aborted)
			throw new DomainError("ACQUISITION_UNAVAILABLE", "Sources are stopping.");
	}
}
