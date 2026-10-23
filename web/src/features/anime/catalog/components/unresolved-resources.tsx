import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { ErrorMessage } from "../../shared/components/error-message.js";
import { workReviewsQuery } from "../queries.js";

export function UnresolvedResources({ workId }: { workId: string }) {
	const { t } = useTranslation();
	const [page, setPage] = useState(1);
	const query = useQuery(workReviewsQuery(workId, page, useQueryScope()));
	if (
		query.data?.items.length === 0 &&
		!query.data.hasNextPage &&
		page === 1 &&
		!query.error
	)
		return null;
	return (
		<section className="space-y-2" aria-label={t("anime.unresolvedResources")}>
			<div className="flex items-start gap-1 text-xs text-muted-foreground">
				<details
					className="group min-w-0"
					onToggle={(event) => {
						console.debug("[AnimeReview] Candidate disclosure toggled.", {
							workId,
							open: event.currentTarget.open,
						});
					}}
				>
					<summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
						<span className="font-medium">
							{t("anime.unresolvedResources")}
						</span>
						<ChevronDown
							className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180"
							aria-hidden="true"
						/>
					</summary>
					<div className="mt-2 space-y-3 text-foreground">
						{query.data && (
							<>
								{query.data.items.length ? (
									<ul className="divide-y">
										{query.data.items.map((item) => (
											<li key={item.id} className="space-y-1 py-2">
												<Link
													to={`/review?item=${encodeURIComponent(item.id)}`}
													className="text-sm underline wrap-anywhere"
												>
													{item.relativePath}
												</Link>
												<p className="text-sm text-muted-foreground">
													{item.unresolved.join(" · ") || t("review.pending")}
													{!item.available && ` · ${t("anime.unavailable")}`}
												</p>
											</li>
										))}
									</ul>
								) : (
									<p>{t("anime.noUnresolvedResources")}</p>
								)}
								{(page > 1 || query.data.hasNextPage) && (
									<div className="flex gap-2">
										<Button
											variant="outline"
											disabled={page === 1 || query.isFetching}
											onClick={() => setPage(page - 1)}
										>
											{t("anime.previous")}
										</Button>
										<Button
											variant="outline"
											disabled={!query.data.hasNextPage || query.isFetching}
											onClick={() => setPage(page + 1)}
										>
											{t("anime.next")}
										</Button>
									</div>
								)}
							</>
						)}
						<Link to="/review?decision=pending" className="text-sm underline">
							{t("anime.allUnresolved")}
						</Link>
					</div>
				</details>
				<Tooltip content={t("anime.unresolvedCandidatesHint")} openOnClick>
					<Button
						variant="ghost"
						className="size-6 shrink-0 p-0 text-muted-foreground"
						aria-label={t("anime.reviewCandidatesInfo")}
					>
						<Info className="size-3.5" aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
			{query.isPending && !query.error && (
				<p role="status" className="text-xs text-muted-foreground">
					{t("anime.loading")}
				</p>
			)}
			{query.error && (
				<ErrorMessage error={query.error} retry={() => void query.refetch()} />
			)}
		</section>
	);
}
