import type { SourceRecord } from "./domain/model.js";
import type { JackettPlan, ReleaseDownload } from "./jackett/model.js";

/** Private bindings and evidence; never contains Jackett credentials. */
export interface ManagedSource {
	id: string;
	binding:
		| { kind: "rss"; url: string }
		| { kind: "jackett"; plan: JackettPlan };
	enabled: boolean;
	failures: number;
	snapshot: SourceRecord | null;
}
export interface SourceDownload {
	id: string;
	sourceId: string;
	generation: string | null;
	descriptor: ReleaseDownload;
}
export interface SourceLifecycleStore {
	transaction(operation: () => void): void;
	download(id: string): SourceDownload | null;
	saveDownload(download: SourceDownload): void;
	source(id: string): ManagedSource | null;
	sources(): ManagedSource[];
	saveSource(source: ManagedSource): void;
	removeSource(id: string): void;
}
