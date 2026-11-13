import { useTranslation } from "react-i18next";
import { PaginationControls } from "../../../../shared/components/ui/pagination-controls.js";

export function LibraryPagination({
	page,
	fetching,
	hasNextPage,
	onPage,
}: {
	page: number;
	fetching: boolean;
	hasNextPage: boolean;
	onPage(page: number): void;
}) {
	const { t } = useTranslation();
	return (
		<PaginationControls
			page={page}
			fetching={fetching}
			hasNextPage={hasNextPage}
			onPage={onPage}
			label={t("anime.pagination")}
		/>
	);
}
