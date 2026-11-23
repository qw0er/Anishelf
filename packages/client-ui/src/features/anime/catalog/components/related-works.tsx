import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../../shared/components/ui/collapsible.js";
import { ExternalLink } from "../../../../shared/components/ui/external-link.js";
import { LoadingState } from "../../../../shared/components/ui/loading-state.js";
import { PaginationControls } from "../../../../shared/components/ui/pagination-controls.js";
import { relationsQuery } from "../../metadata/public.js";
import { ErrorMessage } from "../../shared/components/error-message.js";

const linkClass =
	"touch-control block content-center rounded-sm px-1 py-1 wrap-anywhere hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

export function RelatedWorks({
	workId,
	libraryPath,
}: {
	workId: string;
	libraryPath: string;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [page, setPage] = useState(1);
	const relations = useQuery({
		...relationsQuery(workId, page),
		enabled: open,
	});
	const data = relations.data?.data;
	const library = new URLSearchParams({ library: libraryPath });
	return (
		<Collapsible
			className="surface-panel space-y-3"
			open={open}
			onOpenChange={setOpen}
		>
			<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 font-medium">
				{t("anime.related")}
				<ChevronDown
					className={open ? "size-4 rotate-180" : "size-4"}
					aria-hidden="true"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent>
				{relations.isPending ? (
					<LoadingState label={t("anime.loading")} />
				) : relations.isError && !data ? (
					<ErrorMessage
						error={relations.error}
						retry={() => void relations.refetch()}
					/>
				) : data?.items.length ? (
					<ul className="space-y-1 text-sm">
						{data.items.map((item) => {
							const work = "work" in item ? item.work : item.external;
							const content = (
								<>
									<span className="text-muted-foreground">
										{t(`anime.relationTypes.${item.type}`, {
											defaultValue: item.type.replaceAll("_", " "),
										})}
										{" · "}
									</span>
									<span className="font-medium underline underline-offset-4">
										{work.displayTitle ??
											work.titles[0]?.value ??
											t("anime.unknown")}
									</span>
								</>
							);
							if ("external" in item) {
								const { url, format, year } = item.external;
								return (
									<li key={`${item.type}:${url}`}>
										<ExternalLink className={linkClass} href={url}>
											{content}
											<span className="text-muted-foreground">
												{" · "}
												{t(`anime.relatedFormats.${format}`, {
													defaultValue: format.replaceAll("_", " "),
												})}
												{year ? ` · ${year}` : null}
											</span>
										</ExternalLink>
									</li>
								);
							}
							const { id } = item.work.reference;
							return (
								<li key={`${item.type}:${id}`}>
									<Link
										className={linkClass}
										to={`/anime/works/${encodeURIComponent(id)}?${library}`}
									>
										{content}
									</Link>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							data?.unavailable
								? "anime.relationsUnavailable"
								: "anime.noRelations",
						)}
					</p>
				)}
				{relations.data?.stale && (
					<p className="text-sm text-muted-foreground">{t("anime.stale")}</p>
				)}
				{(page > 1 || data?.hasNextPage) && (
					<PaginationControls
						page={page}
						fetching={relations.isFetching}
						hasNextPage={!!data?.hasNextPage}
						onPage={setPage}
						label={t("anime.related")}
					/>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
