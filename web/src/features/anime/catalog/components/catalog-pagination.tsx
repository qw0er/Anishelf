import { useTranslation } from "react-i18next";
import { Button } from "../../../../shared/components/ui/button.js";

export function CatalogPagination({
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
		<fieldset className="action-row" aria-label={t("anime.pagination")}>
			<Button
				variant="outline"
				disabled={page === 1 || fetching}
				onClick={() => onPage(page - 1)}
			>
				{t("anime.previous")}
			</Button>
			<span>{t("anime.page", { page: page })}</span>
			<Button
				variant="outline"
				disabled={!hasNextPage || fetching}
				onClick={() => onPage(page + 1)}
			>
				{t("anime.next")}
			</Button>
		</fieldset>
	);
}
