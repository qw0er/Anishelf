import type { SourceSnapshot } from "./public.js";
export interface SourcesRuntime {
	start(
		activeIds: () => string[],
		poll: (source: SourceSnapshot) => Promise<void>,
		nextCheckAt?: (source: SourceSnapshot) => number,
	): void;
	close(): Promise<void>;
}
