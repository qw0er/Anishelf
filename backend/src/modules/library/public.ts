export type {
	DirectoryInfo,
	DirectoryListing,
	FileInfo,
	LibraryStatus,
	ResourceInfo,
} from "./domain/model.js";
export type { LibraryIssue, ScanState } from "./domain/scan-state.js";

import type {
	DirectoryListing,
	FileInfo,
	LibraryStatus,
} from "./domain/model.js";
import type { ScanState } from "./domain/scan-state.js";
export interface LibraryApi {
	/** Published-snapshot notifications include root resets; listeners do not block scans. */
	onSnapshotChanged(listener: () => void): () => void;
	readFilePage(
		revision: number,
		offset: number,
		limit: number,
	): { files: FileInfo[]; nextOffset: number | null };
	getStatus(): Promise<LibraryStatus>;
	getDirectory(id: string): DirectoryListing;
	getFile(id: string): Promise<FileInfo>;
	startScan(): Promise<ScanState>;
	cancelScan(): Promise<void>;
}
