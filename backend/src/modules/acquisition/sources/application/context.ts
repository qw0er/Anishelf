import type { Logger } from "pino";
import { rssConstraints } from "../../../../contracts/defaults.js";
import { DomainError } from "../../../../shared/errors.js";
import type { FeedRecord } from "../domain/model.js";
import type { FeedTransport, SourceStore } from "../ports.js";
export interface SourceOptions {
	store: SourceStore;
	transport: FeedTransport;
	parse: (xml: string) => FeedRecord["entries"];
	normalizeUrl: (url: string) => string;
	logger: Logger;
	now?: () => number;
	refreshIntervalMinutes?: () => number | undefined;
}
export class SourceContext {
	readonly shutdown = new AbortController();
	constructor(readonly options: SourceOptions) {}
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
