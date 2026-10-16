import { Info, Link2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
import { Button } from "../../../shared/components/ui/button.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";
import type { ViewingState } from "./use-viewing-state.js";

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
	const { t, i18n } = useTranslation();
	if (!state.visible) return null;
	const snapshot = state.snapshot;
	const entry = snapshot?.entry;
	const hasSnapshot = snapshot !== undefined && snapshot.fetchedAt !== null;
	const unavailable = Boolean(state.error || (snapshot?.error && !hasSnapshot));
	const pending =
		(state.loading || !hasSnapshot) && !unavailable && !state.reconnect;
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
			{snapshot?.stale && snapshot.fetchedAt !== null && (
				<Tooltip
					openOnClick
					content={t("trackingList.cacheInfo", {
						time: new Date(snapshot.fetchedAt).toLocaleString(i18n.language),
					})}
				>
					<Button
						variant="ghost"
						className="h-6 rounded-full bg-muted px-2 text-xs text-muted-foreground"
						aria-label={t("trackingList.cacheDetails")}
					>
						{t("trackingList.cached")}
					</Button>
				</Tooltip>
			)}
			{state.refreshing && !pending && (
				<span role="status" aria-label={t("trackingList.refreshing")}>
					<RefreshCw
						className="size-3.5 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
				</span>
			)}
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
			{state.error && !state.reconnect && (
				<Tooltip content={t("trackingList.entryFailed")}>
					<Button
						variant="ghost"
						className="size-6 shrink-0 p-0"
						aria-label={t("actions.retry")}
						onClick={state.retry}
					>
						<RefreshCw className="size-3.5" aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
		</section>
	);
}
