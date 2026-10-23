import type { SourceSnapshot } from "./public.js";
export interface SourcesRuntime {
	start(
		activeIds: () => string[],
		poll: (source: SourceSnapshot) => Promise<void>,
	): void;
	close(): Promise<void>;
}
