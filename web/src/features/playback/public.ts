export { historyQuery } from "./history/queries.js";

import type { ReactNode } from "react";
import type { PlaybackSource } from "../../shared/api/contracts.js";
export interface PlaybackUiSlots {
	renderOptions?(): ReactNode;
	renderContinuation?(input: {
		fileId: string;
		sourceVersion: string;
		ended: boolean;
		overlayTarget?: HTMLElement | null | undefined;
	}): ReactNode;
	renderViewing?(input: { fileId: string; sourceVersion: string }): ReactNode;
	renderPreparation(input: {
		key: string | number;
		showLabel: boolean;
		fileId: string;
		source: PlaybackSource | null;
		onRecheck(): void;
		onAssetsChanged(): void;
	}): ReactNode;
	renderSubtitles(fileId: string): ReactNode;
}
