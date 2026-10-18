export type {
	DirectoryInfo,
	DirectoryListing,
	LibraryChange,
	LibraryStatus,
	ResourceInfo,
} from "./domain/model.js";
export type { LibraryIssue, ScanState } from "./domain/scan-state.js";

import type {
	DirectoryListing,
	FileInfo,
	LibraryChange,
	LibraryStatus,
} from "./domain/model.js";
import type { ScanState } from "./domain/scan-state.js";
export interface LibraryApi {
	/** Published-snapshot notifications include root resets; listeners do not block scans. */
	onSnapshotChanged(listener: (change: LibraryChange) => void): () => void;
	readFilePage(
		revision: number,
		offset: number,
		limit: number,
	): { files: FileInfo[]; nextOffset: number | null };
	getStatus(): Promise<LibraryStatus>;
	/** Read only a directory group; no full-library enumeration. */
	readDirectoryFiles(id: string): FileInfo[];
	getDirectory(id: string): DirectoryListing;
	getFile(id: string): Promise<FileInfo>;
	startScan(): Promise<ScanState>;
	cancelScan(): Promise<void>;
}
