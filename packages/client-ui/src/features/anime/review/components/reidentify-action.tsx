import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import type { ReviewController } from "../use-review-controller.js";

export function ReidentifyAction({
	item,
	controller,
}: {
	item: CatalogReviewItem;
	controller: Pick<
		ReviewController,
		"busy" | "reidentifyPending" | "reidentify"
	>;
}) {
	const { t } = useTranslation();
	if (item.decision !== "pending") return null;
	return (
		<div className="space-y-2">
			<Button
				variant="outline"
				className="w-full"
				disabled={controller.busy || !item.available}
				aria-busy={controller.reidentifyPending}
				onClick={controller.reidentify}
			>
				<RotateCw
					className={`size-4 ${controller.reidentifyPending ? "motion-safe:animate-spin" : ""}`}
					aria-hidden="true"
				/>
				{t(
					controller.reidentifyPending
						? "review.reidentifying"
						: "review.reidentify",
				)}
			</Button>
			<p className="text-sm leading-relaxed text-muted-foreground">
				{t("review.reidentifyHint")}
			</p>
		</div>
	);
}
