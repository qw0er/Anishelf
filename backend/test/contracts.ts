import type { DirectoryDto, FileDto } from "../src/contracts/api.js";
import type { LoggingConfig } from "../src/contracts/config.js";
import type { ScanState } from "../src/contracts/library.js";

// Compile-time assertions protect boundary and state invariants.
type Assert<T extends true> = T;
export type NoDirectoryPath = Assert<"relativePath" extends keyof DirectoryDto ? false : true>;
export type NoFilePath = Assert<"relativePath" extends keyof FileDto ? false : true>;
export type FileLogRequiresPath = Assert<
  Extract<LoggingConfig, { destination: "file" }> extends { path: string } ? true : false
>;
export type FailedScanRequiresError = Assert<
  Extract<ScanState, { status: "failed" }> extends { error: unknown } ? true : false
>;

