import { useTranslation } from "react-i18next";
import {
	cancelPreparation,
	deletePreparedMedia,
	retryPreparation,
} from "../../../api/client.js";
import type { PreparationTaskResponse } from "../../../api/contracts.js";
import { Button } from "../../../components/ui/button.js";
import { negotiatePreparation } from "../negotiation.js";
import { usePreparationAction } from "../use-preparations.js";

export function PreparationTaskCard({
	task,
	refresh,
	onWatch,
	playing = false,
}: {
	task: PreparationTaskResponse;
	refresh(): void;
	onWatch?(task: PreparationTaskResponse): void;
	playing?: boolean;
}) {
	const { t } = useTranslation();
	const action = usePreparationAction();
	const pending = task.status === "queued" || task.status === "processing";
	return (
		<article className="space-y-3 rounded-md border bg-card p-4">
			<h3 className="font-medium break-all">{task.filename}</h3>
			<p role="status">
				{t(`preparation.status.${task.status}`)} ·{" "}
				{t(`preparation.mode.${task.mode}`)}
			</p>
			<p className="text-sm text-muted-foreground">{task.profileId}</p>
			{task.progress && pending && (
				<>
					<progress
						aria-label={t("preparation.progress")}
						max={100}
						{...(task.progress.percent === null
							? {}
							: { value: task.progress.percent })}
					/>{" "}
					<span>
						{task.progress.percent === null
							? t("preparation.progressUnknown")
							: `${Math.floor(task.progress.percent)}%`}
						{task.progress.speed !== null
							? ` · ${task.progress.speed.toFixed(1)}×`
							: ""}
					</span>
				</>
			)}
			{task.failureReason && (
				<p>{t(`preparation.failure.${task.failureReason}`)}</p>
			)}
			{task.sizeBytes !== null && (
				<p>
					{t("preparation.size", {
						size: (task.sizeBytes / 1024 / 1024).toFixed(1),
					})}
				</p>
			)}
			{task.status === "ready" && task.playbackAvailability !== "ready" && (
				<p>{t("preparation.sourceUnavailable")}</p>
			)}
			<div className="action-row">
				{pending && (
					<Button
						disabled={action.busy}
						variant="outline"
						onClick={() =>
							void action.run(async (signal) => {
								await cancelPreparation(task.id, { signal });
								refresh();
							})
						}
					>
						{t("preparation.cancel")}
					</Button>
				)}
				{(task.status === "failed" || task.status === "cancelled") && (
					<Button
						disabled={action.busy}
						onClick={() =>
							void action.run(async (signal) => {
								const body = await negotiatePreparation(
									task.fileId,
									task.profileId,
									signal,
									task.sourceVersion,
								);
								await retryPreparation(task.id, body, { signal });
								refresh();
							})
						}
					>
						{t("preparation.retry")}
					</Button>
				)}
				{task.status === "ready" && task.playbackUrl && onWatch && (
					<Button
						disabled={action.busy || playing}
						onClick={() => onWatch(task)}
					>
						{t(playing ? "preparation.playing" : "preparation.watch")}
					</Button>
				)}
				{task.artifactId && (
					<Button
						variant="outline"
						disabled={action.busy || playing}
						onClick={() =>
							void action.run(async (signal) => {
								if (task.artifactId)
									await deletePreparedMedia(task.artifactId, { signal });
								refresh();
							})
						}
					>
						{t("preparation.delete")}
					</Button>
				)}
			</div>
		</article>
	);
}
