export type { LibraryContext } from "./library/context.js";
export {
	directoryQuery,
	fileQuery,
	libraryQuery,
	startScan,
} from "./services.js";

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
