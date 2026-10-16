import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
export function ViewingBadge({
	viewing,
}: {
	viewing: { status: string; progress: number };
}) {
	const { t } = useTranslation();
	return (
		<p className="text-xs leading-5 text-muted-foreground">
			{t(`trackingList.statuses.${viewing.status}`)} ·{" "}
			{t("trackingList.progress", { count: viewing.progress })}
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
			{snapshot.stale && snapshot.fetchedAt !== null && (
				<p className="text-xs text-muted-foreground">
					{t("trackingList.stale")}
				</p>
			)}
		</>
	);
}
