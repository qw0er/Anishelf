import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
export function ViewingBadge({
	viewing,
	episodeCount,
}: {
	viewing: { status: string; progress: number };
	episodeCount?: number | null;
}) {
	const { t } = useTranslation();
	return (
		<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
			<span className="sr-only">{t("trackingList.provider")}: </span>
			<span className="rounded-full bg-muted px-2 py-0.5 font-medium">
				{t(`trackingList.statuses.${viewing.status}`)}
			</span>
			<span className="tabular-nums text-muted-foreground">
				{typeof episodeCount === "number" && episodeCount > 0
					? `${viewing.progress} / ${episodeCount}`
					: t("trackingList.watchedCount", { count: viewing.progress })}
			</span>
		</p>
	);
}
export function TrackingFeedback({
	snapshot,
}: {
	snapshot: Pick<
		TrackingEntryResponse,
		"state" | "stale" | "refreshing" | "error" | "fetchedAt"
	>;
}) {
	const { t } = useTranslation();
	if (snapshot.state === "authorization-required")
		return (
			<p role="alert">
				{t("trackingList.reconnect")}{" "}
				<Link className="underline" to="/settings">
					{t("app.settings")}
				</Link>
			</p>
		);
	return (
		<>
			{snapshot.error && snapshot.fetchedAt === null && (
				<p role="alert" className="text-sm">
					{t("trackingList.notLoaded")}
				</p>
			)}
		</>
	);
}
