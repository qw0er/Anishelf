import {
	Ban,
	Check,
	CircleAlert,
	Play,
	RotateCcw,
	Trash2,
	X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	cancelPreparation,
	deletePreparedMedia,
	retryPreparation,
} from "../../../api/client.js";
import type { PreparationTaskResponse } from "../../../api/contracts.js";
import { Button } from "../../../components/ui/button.js";
import { Spinner } from "../../../components/ui/spinner.js";
import { Tooltip } from "../../../components/ui/tooltip.js";
import { negotiatePreparation } from "../negotiation.js";
import { usePreparationAction } from "../use-preparations.js";

export function PreparationTaskCard({
	task,
	refresh,
	onWatch,
	playing = false,
	profileName,
}: {
	task: PreparationTaskResponse;
	refresh(): void;
	onWatch?(task: PreparationTaskResponse): void;
	playing?: boolean;
	profileName?: string | undefined;
}) {
	const { t } = useTranslation();
	const action = usePreparationAction();
	const pending =
		task.status === "queued" ||
		task.status === "processing" ||
		task.status === "cancelling";
	const status = t(`preparation.status.${task.status}`);
	const details = (
		<div className="space-y-1">
			<p className="break-all">{task.filename}</p>
			<p>
				{status} · {t(`preparation.mode.${task.mode}`)}
			</p>
			<p>{profileName ?? t("preparation.profile")}</p>
			{task.audioStreamIndices !== undefined && (
				<p>
					{task.audioStreamIndices.length
						? t("audioTracks.retained", {
								count: task.audioStreamIndices.length,
							})
						: t("audioTracks.none")}
				</p>
			)}
			{task.progress?.speed != null && pending && (
				<p>{task.progress.speed.toFixed(1)}×</p>
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
		</div>
	);
	return (
		<article className="flex min-w-0 items-center gap-2 px-3 py-2">
			<Tooltip content={details}>
				<Button
					variant="ghost"
					className="h-7 min-w-0 flex-1 justify-start gap-2 px-0"
				>
					{pending ? (
						<Spinner className="size-4 shrink-0" />
					) : task.status === "ready" ? (
						<Check
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					) : task.status === "failed" ? (
						<CircleAlert
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					) : (
						<Ban
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					)}
					<span className="truncate text-sm font-medium">{task.filename}</span>
				</Button>
			</Tooltip>
			<span
				role="status"
				aria-label={status}
				className="shrink-0 text-xs text-muted-foreground"
			>
				{pending &&
				task.status !== "cancelling" &&
				task.progress?.percent != null
					? `${Math.floor(task.progress.percent)}%`
					: status}
			</span>
			<div className="flex shrink-0 items-center gap-0.5">
				{pending && (
					<Tooltip content={t("preparation.cancel")}>
						<Button
							variant="ghost"
							className="size-7 p-0 aria-disabled:opacity-50"
							focusableWhenDisabled
							aria-label={t("preparation.cancel")}
							disabled={action.busy || task.status === "cancelling"}
							onClick={() =>
								void action.run(async (signal) => {
									await cancelPreparation(task.id, { signal });
									refresh();
								})
							}
						>
							<X className="size-3.5" aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
				{(task.status === "failed" || task.status === "cancelled") && (
					<Tooltip content={t("preparation.retry")}>
						<Button
							variant="ghost"
							className="size-7 p-0 aria-disabled:opacity-50"
							focusableWhenDisabled
							aria-label={t("preparation.retry")}
							disabled={action.busy}
							onClick={() =>
								void action.run(async (signal) => {
									const body = await negotiatePreparation(
										task.fileId,
										task.profileId,
										signal,
										task.sourceVersion,
										task.audioStreamIndices,
									);
									await retryPreparation(task.id, body, { signal });
									refresh();
								})
							}
						>
							<RotateCcw className="size-3.5" aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
				{task.status === "ready" && task.resource?.url && onWatch && (
					<Tooltip
						content={t(playing ? "preparation.playing" : "preparation.watch")}
					>
						<Button
							variant="ghost"
							className="size-7 p-0 aria-disabled:opacity-50"
							focusableWhenDisabled
							aria-label={t(
								playing ? "preparation.playing" : "preparation.watch",
							)}
							disabled={action.busy || playing}
							onClick={() => onWatch(task)}
						>
							<Play className="size-3.5" aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
				{task.artifactId && (
					<Tooltip content={t("preparation.delete")}>
						<Button
							variant="ghost"
							className="size-7 p-0 aria-disabled:opacity-50"
							focusableWhenDisabled
							aria-label={t("preparation.delete")}
							disabled={action.busy || playing}
							onClick={() =>
								void action.run(async (signal) => {
									if (task.artifactId)
										await deletePreparedMedia(task.artifactId, { signal });
									refresh();
								})
							}
						>
							<Trash2 className="size-3.5" aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
			</div>
		</article>
	);
}
