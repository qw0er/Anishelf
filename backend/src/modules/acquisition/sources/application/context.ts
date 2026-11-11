import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import { sourcePolicy } from "../domain/model.js";
export interface SourceRuntimeOptions {
	logger: Logger;
	now?: () => number;
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
		return sourcePolicy.refreshIntervalMs;
	}
	retryAt(failures: number, hint?: number) {
		return Math.max(
			this.now() +
				Math.min(
					sourcePolicy.retryMaximumMs,
					60_000 * 2 ** Math.min(failures, 6),
				),
			hint && Number.isFinite(hint) ? hint : 0,
		);
	}
	open() {
		if (this.signal.aborted)
			throw new DomainError("ACQUISITION_UNAVAILABLE", "Sources are stopping.");
	}
}
