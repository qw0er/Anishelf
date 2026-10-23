import {
	CircleCheck,
	CircleHelp,
	CircleX,
	Clock3,
	TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { episodeName } from "../../shared/episode-name.js";

export function FileIdentification({
	item,
}: {
	item?: CatalogReviewItem | undefined;
}) {
	const { t } = useTranslation();
	const status = item
		? t(`review.${item.decision}`)
		: t("anime.identificationPending");
	const label = [
		status,
		...(item?.associations.map(
			(link) => `${link.workTitle} · ${episodeName(link, t)}`,
		) ?? []),
		item && !item.available ? t("anime.unavailable") : null,
	]
		.filter(Boolean)
		.join(" · ");
	const Icon =
		item && !item.available
			? TriangleAlert
			: !item
				? Clock3
				: item.decision === "confirmed"
					? CircleCheck
					: item.decision === "rejected"
						? CircleX
						: CircleHelp;
	return (
		<Tooltip content={label} openOnClick>
			<Button
				type="button"
				variant="ghost"
				aria-label={label}
				className="inline-flex size-9 shrink-0 p-0 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Icon size={16} aria-hidden="true" />
			</Button>
		</Tooltip>
	);
}
