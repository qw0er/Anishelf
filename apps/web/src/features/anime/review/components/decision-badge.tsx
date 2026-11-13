import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { StatusBadge } from "../../../../shared/components/ui/status-badge.js";
export function DecisionBadge({
	decision,
}: {
	decision: CatalogReviewItem["decision"];
}) {
	const { t } = useTranslation();
	return (
		<StatusBadge
			tone={
				decision === "confirmed"
					? "success"
					: decision === "pending"
						? "warning"
						: "neutral"
			}
		>
			{t(`review.${decision}`)}
		</StatusBadge>
	);
}
