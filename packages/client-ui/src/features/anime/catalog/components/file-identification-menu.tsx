import { BookOpen, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { DropdownMenuItem } from "../../../../shared/components/ui/dropdown-menu.js";
import { episodeName } from "../../shared/episode-name.js";

export function FileIdentificationMenu({
	item,
}: {
	item?: CatalogReviewItem | undefined;
}) {
	const { t } = useTranslation();
	if (!item) return null;
	const works = [
		...new Map(item.associations.map((link) => [link.workId, link])).values(),
	];
	return (
		<>
			<DropdownMenuItem
				render={<Link to={`/review?item=${encodeURIComponent(item.id)}`} />}
			>
				<ListChecks size={16} aria-hidden="true" />
				{t(item.decision === "confirmed" ? "review.correct" : "review.title")}
			</DropdownMenuItem>
			{works.map((link) => (
				<DropdownMenuItem
					key={link.episodeId}
					render={
						<Link
							to={`/anime/${encodeURIComponent(link.workId)}#episode-${encodeURIComponent(link.episodeId)}`}
						/>
					}
				>
					<BookOpen size={16} aria-hidden="true" />
					<span className="max-w-64 truncate">
						{link.workTitle} · {episodeName(link, t)}
					</span>
				</DropdownMenuItem>
			))}
		</>
	);
}
