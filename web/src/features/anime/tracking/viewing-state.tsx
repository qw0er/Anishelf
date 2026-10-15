import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TrackingEntryResponse } from "../../../shared/api/contracts.js";
import { accountQuery, entryQuery, trackingIdentity } from "./queries.js";
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
export function ViewingPanel({ mediaId }: { mediaId: string }) {
	const account = useQuery(accountQuery());
	const entry = useQuery({
		...entryQuery(
			mediaId,
			account.data
				? trackingIdentity(account.data)
				: { accountId: null, generation: "" },
		),
		enabled: Boolean(account.data?.account),
	});
	const { t } = useTranslation();
	if (!account.data?.account) return null;
	return (
		<section
			className="surface-panel space-y-2"
			aria-label={t("trackingList.viewingState")}
		>
			<h2 className="font-semibold">{t("trackingList.viewingState")}</h2>
			{entry.data?.entry ? (
				<ViewingBadge viewing={entry.data.entry} />
			) : (
				<p>
					{t(
						entry.data?.fetchedAt === null || !entry.data
							? "trackingList.notLoaded"
							: "trackingList.untracked",
					)}
				</p>
			)}
			<p className="text-xs text-muted-foreground">
				{t("trackingList.cumulative")}
			</p>
			{entry.data && <TrackingFeedback snapshot={entry.data} />}
			{entry.error && <p role="alert">{t("trackingList.failed")}</p>}
		</section>
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
			{snapshot.refreshing && (
				<p role="status" className="text-sm">
					{t("trackingList.refreshing")}
				</p>
			)}
			{snapshot.error && (
				<p role="alert" className="text-sm">
					{t("trackingList.failed")}
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
