export { startScan } from "./library/api.js";
export type { LibraryScanState } from "./library/context.js";
export { resourceContext } from "./library/context.js";
export { directoryQuery, libraryQuery } from "./library/queries.js";
export { fileQuery } from "./resource-access/queries.js";

import type { ReactNode } from "react";
import type { PreparationSummaryResponse } from "../../shared/api/contracts.js";

interface FileActionState {
	fileId: string;
	managementMenu?: ReactNode;
	summary?: PreparationSummaryResponse["files"][number] | undefined;
}
export type FileActionSlot = (state: FileActionState) => ReactNode;

export { formatFileSize } from "./library/format-file-size.js";
