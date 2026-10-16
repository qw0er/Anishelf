import { Info, Link2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
import { Button } from "../../../shared/components/ui/button.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";
import { TrackingRefreshHint } from "./refresh-hint.js";
import type { ViewingState } from "./use-viewing-state.js";
import { ViewingEditor } from "./viewing-editor.js";

type ViewingStatus = NonNullable<TrackingEntryResponse["entry"]>["status"];
const statusStyles: Record<ViewingStatus, string> = {
	CURRENT: "bg-primary/10 text-primary",
	PLANNING: "bg-muted text-muted-foreground",
	COMPLETED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	PAUSED: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
	DROPPED: "bg-muted text-muted-foreground",
	REPEATING: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

export function ViewingSummary({
	state,
	episodeCount,
}: {
	state: ViewingState;
	episodeCount?: number | null;
}) {
	const { t } = useTranslation();
	if (!state.visible) return null;
	const snapshot = state.snapshot;
	const entry = snapshot?.entry;
	const hasSnapshot = snapshot !== undefined && snapshot.fetchedAt !== null;
	const unavailable = Boolean(!hasSnapshot && (state.error || snapshot?.error));
	const pending = !hasSnapshot && !unavailable && !state.reconnect;
	const total = episodeCount === undefined ? entry?.episodeCount : episodeCount;
	return (
		<section
			aria-label={t("trackingList.viewingState")}
			className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
		>
			<span className="text-xs font-medium text-muted-foreground">
				{t("trackingList.provider")}
			</span>
			{entry ? (
				<>
					<span
						className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[entry.status]}`}
					>
						{t(`trackingList.statuses.${entry.status}`)}
					</span>
					<span className="tabular-nums">
						{typeof total === "number" && total > 0
							? t("trackingList.episodeProgress", {
									progress: entry.progress,
									total,
								})
							: t("trackingList.episodes", { count: entry.progress })}
					</span>
					<Tooltip content={t("trackingList.cumulative")} openOnClick>
						<Button
							variant="ghost"
							className="size-6 shrink-0 p-0 text-muted-foreground"
							aria-label={t("trackingList.progressInfo")}
						>
							<Info className="size-3.5" aria-hidden="true" />
						</Button>
					</Tooltip>
				</>
			) : pending ? (
				<span
					role="status"
					aria-label={t("trackingList.notLoaded")}
					className="flex items-center gap-2"
				>
					<Skeleton className="h-5 w-20 rounded-full" />
					<Skeleton className="h-4 w-16" />
				</span>
			) : hasSnapshot && !unavailable && !state.reconnect ? (
				<span className="text-xs text-muted-foreground">
					{t("trackingList.untracked")}
				</span>
			) : null}
			{state.reconnect && (
				<Tooltip content={t("trackingList.reconnect")}>
					<Link
						to="/settings"
						className="inline-flex items-center gap-1 text-xs text-amber-700 underline dark:text-amber-300"
					>
						<Link2 className="size-3.5" aria-hidden="true" />
						{t("trackingList.reconnectAction")}
					</Link>
				</Tooltip>
			)}
			{unavailable && !state.reconnect && (
				<span role="alert" className="text-xs text-muted-foreground">
					{t("trackingList.unavailable")}
				</span>
			)}
			<Tooltip
				openOnClick
				content={
					<TrackingRefreshHint
						snapshot={snapshot}
						refreshing={state.refreshing}
					/>
				}
			>
				<Button
					variant="ghost"
					className="size-6 shrink-0 p-0"
					aria-label={t(
						!hasSnapshot && state.error
							? "actions.retry"
							: "trackingList.refresh",
					)}
					aria-busy={state.refreshing}
					aria-disabled={state.refreshing || state.reconnect}
					onClick={() => {
						if (!state.refreshing && !state.reconnect) {
							if (!hasSnapshot || state.error) state.retry();
							else (state.refresh ?? state.retry)();
						}
					}}
				>
					<RefreshCw
						className={state.refreshing ? "size-3.5 animate-spin" : "size-3.5"}
						aria-hidden="true"
					/>
				</Button>
			</Tooltip>
			{state.mediaId && <ViewingEditor state={state} mediaId={state.mediaId} />}
		</section>
	);
}
