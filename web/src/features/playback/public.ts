export { historyQuery } from "./history/queries.js";

import type { ReactNode } from "react";
import type { CompatibilityResult } from "../../shared/api/contracts.js";
export interface PlaybackUiSlots {
	renderPreparation(input: {
		key: string | number;
		showLabel: boolean;
		fileId: string;
		loading: boolean;
		result: CompatibilityResult | null;
		error: unknown;
		onRecheck(): void;
		tasks: import("../../shared/api/contracts.js").PreparationTaskResponse[];
		onPrepared(
			task: import("../../shared/api/contracts.js").PreparationTaskResponse,
		): void;
		audioStreamIndices?: number[];
	}): ReactNode;
	renderSubtitles(fileId: string): ReactNode;
}
