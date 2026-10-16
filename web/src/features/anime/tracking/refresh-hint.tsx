import { useTranslation } from "react-i18next";
export function TrackingRefreshHint({
	snapshot,
	refreshing,
}: {
	snapshot: { fetchedAt: number | null; stale: boolean } | undefined;
	refreshing: boolean;
}) {
	const { t, i18n } = useTranslation();
	return (
		<span className="grid gap-1">
			<span>
				{t(refreshing ? "trackingList.refreshing" : "trackingList.refresh")}
			</span>
			{snapshot?.fetchedAt != null && (
				<span>
					{t("trackingList.updatedAt", {
						time: new Date(snapshot.fetchedAt).toLocaleString(i18n.language),
					})}
				</span>
			)}
			{snapshot?.stale && snapshot.fetchedAt !== null && (
				<span>{t("trackingList.stale")}</span>
			)}
		</span>
	);
}
