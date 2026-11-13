import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DropdownMenuItem } from "../../../../shared/components/ui/dropdown-menu.js";

export function AssociationCorrectionMenuItem({
	reviewId,
}: {
	reviewId: string;
}) {
	const { t } = useTranslation();
	return (
		<DropdownMenuItem
			render={
				<Link
					to={`/review?${new URLSearchParams({ item: reviewId, decision: "confirmed" })}`}
				/>
			}
			onClick={() => {
				console.debug("[AnimeReview] Opening association correction.", {
					reviewId,
				});
			}}
		>
			<ListChecks className="size-4" aria-hidden="true" />
			{t("review.correct")}
		</DropdownMenuItem>
	);
}
