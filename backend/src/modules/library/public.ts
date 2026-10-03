export type {
	DirectoryInfo,
	DirectoryListing,
	FileInfo,
	LibraryStatus,
	ResourceInfo,
} from "./domain/model.js";
export type { LibraryIssue, ScanState } from "./domain/scan-state.js";

import type { LibraryApplication } from "./application/library.js";
export type LibraryApi = Pick<
	LibraryApplication,
	"getStatus" | "getDirectory" | "getFile" | "startScan" | "cancelScan"
>;

export type { LibraryPolicy } from "./domain/policy.js";
export { libraryPolicy, validateLibraryPolicy } from "./domain/policy.js";
