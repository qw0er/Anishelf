import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { episodeName } from "../../shared/episode-name.js";

export function FileIdentification({
	item,
}: {
	item?: CatalogReviewItem | undefined;
}) {
	const { t } = useTranslation();
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
			<span>
				{item ? t(`review.${item.decision}`) : t("anime.identificationPending")}
			</span>
			{item?.associations.map((link) => (
				<Link
					key={link.episodeId}
					to={`/anime/${encodeURIComponent(link.workId)}#episode-${encodeURIComponent(link.episodeId)}`}
					className="underline wrap-anywhere"
				>
					{link.workTitle} · {episodeName(link, t)}
				</Link>
			))}
			{item && !item.available && <span>{t("anime.unavailable")}</span>}
			{item && (
				<Link
					to={`/review?item=${encodeURIComponent(item.id)}`}
					className="underline"
				>
					{t(item.decision === "confirmed" ? "review.correct" : "review.title")}
				</Link>
			)}
		</div>
	);
}
