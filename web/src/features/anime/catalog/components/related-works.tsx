import { useTranslation } from "react-i18next";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../../shared/components/ui/collapsible.js";
import { LoadingState } from "../../../../shared/components/ui/loading-state.js";
import { PaginationControls } from "../../../../shared/components/ui/pagination-controls.js";
import { ErrorMessage } from "../../shared/components/error-message.js";
import type { LocalWorkDetailController } from "../use-local-work-detail.js";
export function RelatedWorks({
	controller,
}: {
	controller: Pick<
		LocalWorkDetailController,
		"relations" | "relationsPage" | "changeRelationsPage"
	>;
}) {
	const { t } = useTranslation();
	const { relations, relationsPage, changeRelationsPage } = controller;
	return (
		<Collapsible className="surface-panel space-y-3">
			<CollapsibleTrigger className="cursor-pointer font-medium">
				{t("anime.related")}
			</CollapsibleTrigger>
			<CollapsibleContent keepMounted>
				{relations.isPending && !relations.data ? (
					<LoadingState label={t("anime.loading")} />
				) : relations.isError && !relations.data ? (
					<ErrorMessage
						error={relations.error}
						retry={() => void relations.refetch()}
					/>
				) : relations.data?.data.items.length ? (
					<ul className="space-y-1 text-sm">
						{relations.data.data.items.map((relation) => (
							<li
								key={`${relation.type}:${relation.work.reference.id}`}
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
					<PaginationControls
						page={relationsPage}
						fetching={relations.isFetching}
						hasNextPage={!!relations.data?.data.hasNextPage}
						onPage={changeRelationsPage}
						label={t("anime.related")}
					/>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
