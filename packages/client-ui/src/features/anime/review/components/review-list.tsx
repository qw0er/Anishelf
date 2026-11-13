import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronRight, FileVideo, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CatalogReviewResponse } from "../../../../shared/api/contracts.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { LoadingState } from "../../../../shared/components/ui/loading-state.js";
import { PaginationControls } from "../../../../shared/components/ui/pagination-controls.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { ErrorMessage } from "../../shared/components/error-message.js";
import { DecisionBadge } from "./decision-badge.js";
export function ReviewList({
	decision,
	page,
	query,
	onPage,
}: {
	decision: string;
	page: number;
	query: UseQueryResult<CatalogReviewResponse>;
	onPage(page: number): void;
}) {
	const { t } = useTranslation();
	return (
		<div className="surface-panel space-y-4">
			<nav
				aria-label={t("review.decision")}
				className="flex flex-wrap gap-1 border-b pb-4"
			>
				{["pending", "confirmed", "rejected"].map((value) => (
					<Link
						key={value}
						to={`/review?decision=${value}`}
						aria-current={decision === value ? "page" : undefined}
						className={buttonStyles(
							decision === value ? "default" : "ghost",
							"min-w-0 flex-auto px-3 sm:flex-none",
						)}
					>
						{t(`review.${value}`)}
					</Link>
				))}
			</nav>
			{query.isPending && !query.error && (
				<LoadingState label={t("anime.loading")} />
			)}
			{query.error && (
				<ErrorMessage error={query.error} retry={() => void query.refetch()} />
			)}
			{query.data && (
				<>
					{query.data.items.length ? (
						<ul className="divide-y">
							{query.data.items.map((row) => (
								<li
									key={row.id}
									className="list-row flex flex-col sm:flex-row sm:items-center"
								>
									<div className="hidden size-11 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground sm:flex">
										<FileVideo className="size-5" aria-hidden="true" />
									</div>
									<div className="min-w-0 flex-1 space-y-2">
										<div className="flex flex-wrap items-center gap-2">
											<DecisionBadge decision={row.decision} />
											{!row.available && (
												<span className="text-xs text-destructive">
													{t("anime.unavailable")}
												</span>
											)}
										</div>
										<p className="wrap-anywhere font-medium leading-snug">
											{row.evidence.originalName}
										</p>
										{row.relativePath !== row.evidence.originalName && (
											<Tooltip content={row.relativePath} openOnClick>
												<button
													type="button"
													className="touch-control block max-w-full truncate rounded-md focus-visible:outline-2 focus-visible:outline-ring text-xs text-muted-foreground"
													aria-label={row.relativePath}
												>
													{row.relativePath}
												</button>
											</Tooltip>
										)}
										{row.associations.length ? (
											<p className="text-sm wrap-anywhere text-muted-foreground">
												{row.associations
													.map((link) => `${link.workTitle} · ${link.label}`)
													.join(" / ")}
											</p>
										) : (
											<p className="text-sm wrap-anywhere text-muted-foreground">
												{row.proposals[0]?.candidate.work.displayTitle ??
													row.proposals[0]?.candidate.work.titles[0] ??
													t("review.noMatch")}
												{row.proposals.length > 0 &&
													` · ${t("review.suggestionCount", { count: row.proposals.length })}`}
											</p>
										)}
									</div>
									<Link
										className={buttonStyles(
											"outline",
											"shrink-0 sm:self-center",
										)}
										to={`/review?${new URLSearchParams({ item: row.id, decision, page: String(page) })}`}
									>
										{t(
											row.decision === "confirmed"
												? "review.correct"
												: "review.inspect",
										)}
										<ChevronRight className="size-4" aria-hidden="true" />
									</Link>
								</li>
							))}
						</ul>
					) : !query.error ? (
						<EmptyState
							embedded
							icon={<ShieldCheck size={24} />}
							title={t("review.empty")}
							actions={
								page > 1 && (
									<Button
										variant="outline"
										onClick={() => {
											console.debug(
												"[Review] Returning to the first inventory page.",
												{ decision },
											);
											onPage(1);
										}}
									>
										{t("pagination.first")}
									</Button>
								)
							}
						/>
					) : null}
					{query.data.items.length > 0 &&
						(page > 1 || query.data.hasNextPage) && (
							<div className="border-t pt-4">
								<PaginationControls
									page={page}
									fetching={query.isFetching}
									hasNextPage={query.data.hasNextPage}
									onPage={onPage}
									label={t("anime.pagination")}
								/>
							</div>
						)}
				</>
			)}
		</div>
	);
}
