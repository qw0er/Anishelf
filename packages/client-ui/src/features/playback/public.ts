export { historyQuery } from "./history/queries.js";

import type { ReactNode } from "react";
import type { PlaybackSource } from "../../shared/api/contracts.js";
export interface NextEpisodeAction {
	label: string;
	run(): void;
}

export interface PlaybackUiSlots {
	renderContinuation?(input: {
		fileId: string;
		sourceVersion: string;
		renderPlayer(next?: NextEpisodeAction): ReactNode;
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
}
