import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
export function DecisionBadge({
	decision,
}: {
	decision: CatalogReviewItem["decision"];
}) {
	const { t } = useTranslation();
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${decision === "confirmed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : decision === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}
		>
			<span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
			{t(`review.${decision}`)}
		</span>
	);
}
