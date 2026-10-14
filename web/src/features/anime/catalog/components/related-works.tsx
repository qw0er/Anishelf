import { useTranslation } from "react-i18next";
import { Button } from "../../../../shared/components/ui/button.js";
import type { WorkDetailController } from "../use-work-detail.js";
export function RelatedWorks({
	controller,
}: {
	controller: Pick<
		WorkDetailController,
		"relations" | "relationsPage" | "changeRelationsPage"
	>;
}) {
	const { t } = useTranslation();
	const { relations, relationsPage, changeRelationsPage } = controller;
	return (
		<details className="surface-panel space-y-3">
			<summary className="cursor-pointer font-medium">
				{t("anime.related")}
			</summary>
			{relations.data?.data.items.length ? (
				<ul className="space-y-1 text-sm">
					{relations.data.data.items.map((relation) => (
						<li
							key={`${relation.type}:${relation.work.reference.provider}:${relation.work.reference.id}`}
							className="wrap-anywhere"
						>
							{relation.type.replaceAll("_", " ")} ·{" "}
							{relation.work.titles[0]?.value ?? t("anime.unknown")}
						</li>
					))}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">
					{t("anime.unknownRelations")}
				</p>
			)}
			{(relationsPage > 1 || relations.data?.data.hasNextPage) && (
				<fieldset className="action-row" aria-label={t("anime.related")}>
					<Button
						variant="outline"
						disabled={relationsPage === 1 || relations.isFetching}
						onClick={() => changeRelationsPage(relationsPage - 1)}
					>
						{t("anime.previous")}
					</Button>
					<span>{t("anime.page", { page: relationsPage })}</span>
					<Button
						variant="outline"
						disabled={!relations.data?.data.hasNextPage || relations.isFetching}
						onClick={() => changeRelationsPage(relationsPage + 1)}
					>
						{t("anime.next")}
					</Button>
				</fieldset>
			)}
		</details>
	);
}
