import { Info, Link2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "../../../shared/components/ui/button.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { StatusBadge } from "../../../shared/components/ui/status-badge.js";
import { Tooltip } from "../../../shared/components/ui/tooltip.js";
import { sentenceViewingProgress } from "./progress-format.js";
import { TrackingRefreshHint } from "./refresh-hint.js";
import type { ViewingState } from "./use-viewing-state.js";
import { ViewingEditor } from "./viewing-editor.js";
import { viewingTone } from "./viewing-tone.js";

export function ViewingSummary({
	state,
	episodeCount,
	airedEpisodeCount,
}: {
	state: ViewingState;
	episodeCount?: number | null;
	airedEpisodeCount?: number | null;
}) {
	const { t } = useTranslation();
	if (!state.visible) return null;
	if (state.unmapped)
		return (
			<p className="text-sm text-muted-foreground">
				{t("trackingList.unmapped")}
			</p>
		);
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
				{snapshot?.provider.name ?? t("trackingList.provider")}
			</span>
			{entry ? (
				<>
					<StatusBadge tone={viewingTone(entry.status)}>
						{t(`trackingList.statuses.${entry.status}`)}
					</StatusBadge>
					<span className="tabular-nums">
						{sentenceViewingProgress(
							{
								progress: entry.progress,
								aired: airedEpisodeCount,
								total,
							},
							t,
						)}
					</span>
					<Tooltip content={t("trackingList.cumulative")} openOnClick>
						<Button
							size="icon"
							variant="ghost"
							className="text-muted-foreground"
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
						className="inline-flex items-center gap-1 text-xs text-warning underline"
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
					size="icon"
					variant="ghost"
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
