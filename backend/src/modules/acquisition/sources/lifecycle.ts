import type { SourceBinding } from "./domain/binding.js";
import type { ReleaseDownload } from "./domain/download.js";
import type { SourceRecord } from "./domain/model.js";

/** Private bindings and evidence; never contains Jackett credentials. */
export interface ManagedSource {
	id: string;
	binding: SourceBinding;
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
