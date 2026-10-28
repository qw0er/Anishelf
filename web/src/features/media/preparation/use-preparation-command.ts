import { useTranslation } from "react-i18next";
import type { PreparationTaskResponse } from "../../../shared/api/contracts.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { createPreparation, retryPreparation } from "./api.js";
import {
	matchesAudioSelection,
	type PreparationSource,
} from "./audio-tracks.js";
import { usePreparationContext } from "./context.js";
import { negotiatePreparation } from "./negotiation.js";
import { usePreparationAction } from "./use-preparations.js";

export function usePreparationCommand({
	fileId,
	source,
	tasks,
	audioStreamIndices,
	onPrepared,
	onRecheck,
	onComplete,
}: {
	fileId: string;
	source: PreparationSource | null;
	tasks?: PreparationTaskResponse[];
	audioStreamIndices?: number[];
	onPrepared?(task: PreparationTaskResponse): void;
	onRecheck(): void;
	onComplete(): void;
}) {
	const { t } = useTranslation();
	const preparation = usePreparationContext();
	const action = usePreparationAction();
	const allTracks = (source?.audioTracks ?? []).map((stream) => stream.index);
	const profileLoading = !preparation.catalog && !preparation.catalogError;
	const sourceVersion = source?.sourceVersion;
	const profile = preparation.catalog?.selectionAvailable
		? preparation.catalog.selectedProfileId
		: null;
	const task = (tasks ?? preparation.tasks).find(
		(task) =>
			task.fileId === fileId &&
			sourceVersion !== undefined &&
			task.sourceVersion === sourceVersion &&
			task.profileId === profile &&
			(preparation.catalog?.preparationMode !== "compatible" ||
				task.mode === "transcode") &&
			matchesAudioSelection(task, audioStreamIndices, allTracks),
	);
	const pending =
		task?.status === "queued" ||
		task?.status === "processing" ||
		task?.status === "cancelling";
	function start() {
		if (!profile || pending || task?.status === "ready") return;
		void action.run(async (signal) => {
			const body = await negotiatePreparation(
				fileId,
				profile,
				signal,
				sourceVersion,
				audioStreamIndices,
			);
			if (task && (task.status === "failed" || task.status === "cancelled")) {
				const retried = await retryPreparation(task.id, body, { signal });
				if (signal.aborted) return;
				onPrepared?.(retried);
				onComplete();
				return;
			}
			const response = await createPreparation(fileId, body, { signal });
			if (signal.aborted) return;
			if (response.kind === "task") {
				onPrepared?.(response.task);
				onComplete();
			} else if (response.kind === "direct") onRecheck();
			else
				toast.add({
					type: "warning",
					title: t(`compatibility.reasons.${response.reason}`, {
						defaultValue: t("preparation.blocked"),
					}),
				});
		});
	}
	return { profileLoading, profile, task, pending, busy: action.busy, start };
}
