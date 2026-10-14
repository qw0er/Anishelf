import { Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Input } from "../../../../shared/components/ui/input.js";
import { ErrorMessage } from "../../shared/components/error-message.js";
import type { ReviewController } from "../use-review-controller.js";

export function CandidateSelection({
	item,
	controller,
}: {
	item: CatalogReviewItem;
	controller: Pick<
		ReviewController,
		| "reference"
		| "busy"
		| "search"
		| "searchPage"
		| "searchQuery"
		| "selectWork"
		| "searchWorks"
		| "lookupWork"
		| "changeSearchPage"
	>;
}) {
	const { t } = useTranslation();
	const {
		reference,
		busy,
		search,
		searchPage,
		searchQuery,
		selectWork,
		searchWorks,
		lookupWork,
		changeSearchPage,
	} = controller;
	return (
		<section className="min-w-0 space-y-5 rounded-lg border bg-card p-4 sm:p-5">
			<div className="flex items-center gap-2">
				<span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
					1
				</span>
				<h2 className="font-semibold">{t("review.chooseWork")}</h2>
			</div>
			<section className="space-y-3">
				<h3 className="text-sm font-medium text-muted-foreground">
					{t("review.candidates")}
				</h3>
				{item.proposals.length === 0 && <p>{t("review.noCandidates")}</p>}
				<ul
					className={`grid gap-3 ${item.proposals.length > 1 ? "sm:grid-cols-2" : ""}`}
				>
					{item.proposals.map((proposal) => {
						const candidate = proposal.candidate;
						const selected =
							reference?.provider === candidate.work.reference.provider &&
							reference.id === candidate.work.reference.id;
						const warnings = [
							...candidate.conflicts,
							...proposal.mapping.unresolved,
						];
						return (
							<li
								key={`${candidate.work.reference.provider}:${candidate.work.reference.id}`}
								className={`flex min-w-0 flex-col gap-3 rounded-lg border p-4 ${selected ? "border-primary bg-primary/5" : "bg-background"}`}
							>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0 space-y-1">
										<p className="font-medium wrap-anywhere">
											{candidate.work.titles[0]}
										</p>
										<p className="text-xs text-muted-foreground">
											{candidate.work.format ?? t("anime.unknown")} ·{" "}
											{candidate.work.year ?? t("anime.unknown")} ·{" "}
											{candidate.work.reference.provider}
										</p>
									</div>
									<span
										title={t("review.rank", { score: candidate.score })}
										className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium"
									>
										{t("review.score", { score: candidate.score })}
									</span>
								</div>
								{warnings.length > 0 && (
									<ul className="space-y-1 rounded-lg bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
										{warnings.map((reason) => (
											<li className="wrap-anywhere" key={reason}>
												{reason}
											</li>
										))}
									</ul>
								)}
								<details className="text-xs text-muted-foreground">
									<summary className="cursor-pointer">
										{t("review.matchDetails")}
									</summary>
									<ul className="mt-2 space-y-1 leading-relaxed">
										{[
											...candidate.reasons,
											...(candidate.assumptions ?? []),
										].map((reason) => (
											<li className="wrap-anywhere" key={reason}>
												{reason}
											</li>
										))}
									</ul>
									<p className="mt-2">
										{t("review.rank", { score: candidate.score })}
									</p>
								</details>
								<Button
									className="mt-auto w-full"
									variant={selected ? "secondary" : "outline"}
									aria-pressed={selected}
									disabled={busy}
									onClick={() => {
										selectWork(candidate.work.reference);
									}}
								>
									{selected && <Check className="size-4" aria-hidden="true" />}
									{t(selected ? "review.selected" : "review.select")}
								</Button>
							</li>
						);
					})}
				</ul>
			</section>

			<div className="space-y-4 border-t pt-4">
				<div className="flex items-center gap-2 text-sm font-medium">
					<Search className="size-4 text-muted-foreground" aria-hidden="true" />
					{t("review.findAnother")}
				</div>
				<div className="grid min-w-0 gap-4 xl:grid-cols-2">
					<form
						className="flex min-w-0 items-end gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							searchWorks(
								String(
									new FormData(event.currentTarget).get("search") ?? "",
								).trim(),
							);
						}}
					>
						<label
							htmlFor="candidate-search"
							className="min-w-0 flex-1 space-y-1.5 text-xs font-medium"
						>
							{t("review.search")}
							<Input
								id="candidate-search"
								name="search"
								maxLength={200}
								placeholder={t("review.searchPlaceholder")}
								disabled={busy}
								required
							/>
						</label>
						<Button type="submit" disabled={busy}>
							{t("review.searchAction")}
						</Button>
					</form>
					<form
						className="flex min-w-0 items-end gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							lookupWork(
								String(
									new FormData(event.currentTarget).get("anilistId") ?? "",
								).trim(),
							);
						}}
					>
						<label
							htmlFor="provider-id"
							className="min-w-0 flex-1 space-y-1.5 text-xs font-medium"
						>
							{t("review.providerId")}
							<Input
								id="provider-id"
								name="anilistId"
								disabled={busy}
								required
							/>
						</label>
						<Button type="submit" variant="outline" disabled={busy}>
							{t("review.lookup")}
						</Button>
					</form>
				</div>
			</div>
			{search && (
				<section className="space-y-3">
					{searchQuery.error && (
						<ErrorMessage
							error={searchQuery.error}
							retry={() => void searchQuery.refetch()}
						/>
					)}
					{searchQuery.isPending && !searchQuery.error && (
						<p role="status">{t("anime.loading")}</p>
					)}
					{searchQuery.data && (
						<>
							<ul className="space-y-2">
								{searchQuery.data.data.items.map((candidate) => (
									<li
										key={`${candidate.reference.provider}:${candidate.reference.id}`}
										className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
									>
										<p className="min-w-0 flex-1 wrap-anywhere">
											{candidate.titles[0]?.value ?? t("anime.unknown")} ·{" "}
											{candidate.format ?? t("anime.unknown")} ·{" "}
											{candidate.year ?? t("anime.unknown")}
										</p>
										<Button
											disabled={busy}
											variant="outline"
											onClick={() => {
												selectWork(candidate.reference);
											}}
										>
											{t("review.select")}
										</Button>
									</li>
								))}
							</ul>
							{!searchQuery.data.data.items.length && (
								<p>{t("anime.noResults")}</p>
							)}
							<fieldset className="action-row" aria-label={t("review.search")}>
								<Button
									variant="outline"
									disabled={searchPage === 1 || searchQuery.isFetching}
									onClick={() => changeSearchPage(searchPage - 1)}
								>
									{t("anime.previous")}
								</Button>
								<span>{t("anime.page", { page: searchPage })}</span>
								<Button
									variant="outline"
									disabled={
										!searchQuery.data.data.hasNextPage || searchQuery.isFetching
									}
									onClick={() => changeSearchPage(searchPage + 1)}
								>
									{t("anime.next")}
								</Button>
							</fieldset>
						</>
					)}
				</section>
			)}
		</section>
	);
}
