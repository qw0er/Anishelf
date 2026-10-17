export { startScan } from "./library/api.js";
export type { LibraryScanState } from "./library/context.js";
export { resourceContext } from "./library/context.js";
export { directoryQuery, libraryQuery } from "./library/queries.js";
export { fileQuery } from "./resource-access/queries.js";

import type { ReactNode } from "react";
import type {
	CompatibilityResult,
	PreparationSummaryResponse,
} from "../../shared/api/contracts.js";

interface FileActionState {
	fileId: string;
	summary?: PreparationSummaryResponse["files"][number] | undefined;
	loading: boolean;
	result: CompatibilityResult | null;
	error: unknown;
	onRecheck(): void;
}
export type FileActionSlot = (state: FileActionState) => ReactNode;
