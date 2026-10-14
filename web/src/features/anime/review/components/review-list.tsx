import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronRight, FileVideo, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CatalogReviewResponse } from "../../../../shared/api/contracts.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
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
		<>
			<nav
				aria-label={t("review.decision")}
				className="flex flex-wrap gap-1 rounded-xl border bg-muted/30 p-1.5"
			>
				{["pending", "confirmed", "rejected"].map((value) => (
					<Link
						key={value}
						to={`/review?decision=${value}`}
						aria-current={decision === value ? "page" : undefined}
						className={buttonStyles(
							decision === value ? "default" : "ghost",
							"min-w-0 flex-1 px-3 sm:flex-none",
						)}
					>
						{t(`review.${value}`)}
					</Link>
				))}
			</nav>
			{query.isPending && !query.error && (
				<p role="status">{t("anime.loading")}</p>
			)}
			{query.error && (
				<ErrorMessage error={query.error} retry={() => void query.refetch()} />
			)}
			{query.data && (
				<>
					{query.data.items.length ? (
						<ul className="space-y-3">
							{query.data.items.map((row) => (
								<li
									key={row.id}
									className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30 sm:flex-row sm:items-center sm:p-5"
								>
									<div className="hidden size-11 shrink-0 items-center justify-center rounded-xl border bg-muted/40 text-muted-foreground sm:flex">
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
											<p
												className="truncate text-xs text-muted-foreground"
												title={row.relativePath}
											>
												{row.relativePath}
											</p>
										)}
										{row.associations.length ? (
											<p className="text-sm wrap-anywhere text-muted-foreground">
												{row.associations
													.map((link) => `${link.workTitle} · ${link.label}`)
													.join(" / ")}
											</p>
										) : (
											<p className="text-sm wrap-anywhere text-muted-foreground">
												{row.proposals[0]?.candidate.work.titles[0] ??
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
					) : (
						<div
							role="status"
							className="rounded-xl border border-dashed p-10 text-center"
						>
							<ShieldCheck
								className="mx-auto mb-3 size-8 text-muted-foreground"
								aria-hidden="true"
							/>
							<p className="font-medium">{t("review.empty")}</p>
						</div>
					)}
					<fieldset
						className="flex items-center justify-between gap-3 border-t pt-4 text-sm"
						aria-label={t("anime.pagination")}
					>
						<Button
							variant="outline"
							disabled={page === 1 || query.isFetching}
							onClick={() => onPage(page - 1)}
						>
							{t("anime.previous")}
						</Button>
						<span className="text-muted-foreground">
							{t("anime.page", { page })}
						</span>
						<Button
							variant="outline"
							disabled={!query.data.hasNextPage || query.isFetching}
							onClick={() => onPage(page + 1)}
						>
							{t("anime.next")}
						</Button>
					</fieldset>
				</>
			)}
		</>
	);
}
