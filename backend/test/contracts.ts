import type { LoggingConfig } from "../src/config/model.js";
import type { DirectoryDto, FileDto } from "../src/http/contracts.js";
import type { ScanState } from "../src/library/scan-state.js";

// Compile-time assertions protect boundary and state invariants.
type Assert<T extends true> = T;
export type NoDirectoryPath = Assert<
	"relativePath" extends keyof DirectoryDto ? false : true
>;
export type NoFilePath = Assert<
	"relativePath" extends keyof FileDto ? false : true
>;
export type FileLogRequiresPath = Assert<
	Extract<LoggingConfig, { destination: "file" }> extends { path: string }
		? true
		: false
>;
export type FailedScanRequiresError = Assert<
	Extract<ScanState, { status: "failed" }> extends { error: unknown }
		? true
		: false
>;
