import { useTranslation } from "react-i18next";
import { Button } from "./button.js";
import { Pagination, PaginationContent, PaginationItem } from "./pagination.js";
export function PaginationControls({
	page,
	fetching,
	hasNextPage,
	onPage,
	label,
}: {
	page: number;
	fetching: boolean;
	hasNextPage: boolean;
	onPage(page: number): void;
	label: string;
}) {
	const { t } = useTranslation();
	return (
		<Pagination className="justify-start" aria-label={label}>
			<PaginationContent className="flex-wrap gap-2">
				<PaginationItem>
					<Button
						variant="outline"
						disabled={page === 1 || fetching}
						onClick={() => onPage(page - 1)}
					>
						{t("anime.previous")}
					</Button>
				</PaginationItem>
				<PaginationItem aria-live="polite">
					{t("anime.page", { page })}
				</PaginationItem>
				<PaginationItem>
					<Button
						variant="outline"
						disabled={!hasNextPage || fetching}
						onClick={() => onPage(page + 1)}
					>
						{t("anime.next")}
					</Button>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
