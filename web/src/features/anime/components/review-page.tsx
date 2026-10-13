import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronRight,
	FileVideo,
	Search,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type {
	CatalogPreviewResponse,
	CatalogReviewItem,
} from "../../../shared/api/contracts.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { Button, buttonStyles } from "../../../shared/components/ui/button.js";
import { Input } from "../../../shared/components/ui/input.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import { confirmMapping, decideReview, previewMapping } from "../api.js";
import {
	metadataDetailQuery,
	metadataSearchQuery,
	reviewQuery,
	reviewsQuery,
} from "../queries.js";
import { Artwork } from "./artwork.js";
import { IdentificationStatus } from "./identification-status.js";

const selectStyle =
	"h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring";
function DecisionBadge({
	decision,
}: {
	decision: CatalogReviewItem["decision"];
}) {
	const { t } = useTranslation();
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${decision === "confirmed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : decision === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}
		>
			<span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
			{t(`review.${decision}`)}
		</span>
	);
}
export function ReviewPage() {
	const [params, setParams] = useSearchParams();
	const item = params.get("item");
	const decision = ["pending", "confirmed", "rejected"].includes(
		params.get("decision") ?? "",
	)
		? (params.get("decision") ?? "pending")
		: "pending";
	const rawPage = params.get("page") ?? "1";
	const page = /^[1-9][0-9]{0,4}$/.test(rawPage) ? Number(rawPage) : 1;
	const scope = useQueryScope();
	const { t } = useTranslation();
	const query = useQuery({
		...reviewsQuery(decision, page, scope),
		enabled: !item,
	});
	const listUrl = `/review?${new URLSearchParams({ decision, page: String(page) })}`;
	return (
		<section className="min-w-0 space-y-6">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="max-w-2xl space-y-2">
					<h1 className="page-title">{t("review.title")}</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{t("review.hint")}
					</p>
				</div>
				{item && (
					<Link to={listUrl} className={buttonStyles("outline")}>
						<ArrowLeft className="size-4" aria-hidden="true" />
						{t("review.back")}
					</Link>
				)}
			</header>
			<IdentificationStatus />
			{item ? (
				<ReviewEditor key={`${item}:${scope}`} id={item} />
			) : (
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
						<ErrorMessage
							error={query.error}
							retry={() => void query.refetch()}
						/>
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
															.map(
																(link) => `${link.workTitle} · ${link.label}`,
															)
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
									onClick={() =>
										setParams({ decision, page: String(page - 1) })
									}
								>
									{t("anime.previous")}
								</Button>
								<span className="text-muted-foreground">
									{t("anime.page", { page })}
								</span>
								<Button
									variant="outline"
									disabled={!query.data.hasNextPage || query.isFetching}
									onClick={() =>
										setParams({ decision, page: String(page + 1) })
									}
								>
									{t("anime.next")}
								</Button>
							</fieldset>
						</>
					)}
				</>
			)}
		</section>
	);
}
function ReviewEditor({ id }: { id: string }) {
	const query = useQuery(reviewQuery(id, useQueryScope()));
	const { t } = useTranslation();
	return query.data ? (
		<MappingEditor key={id} item={query.data} />
	) : query.error ? (
		<ErrorMessage error={query.error} retry={() => void query.refetch()} />
	) : (
		<p role="status">{t("anime.loading")}</p>
	);
}
function MappingEditor({ item }: { item: CatalogReviewItem }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [reference, setReference] = useState<{
		provider: string;
		mediaType: "anime";
		id: string;
	} | null>(null);
	const [search, setSearch] = useState("");
	const [searchPage, setSearchPage] = useState(1);
	const [preview, setPreview] = useState<CatalogPreviewResponse | null>(null);
	const [operationKey, setOperationKey] = useState("");
	const [replace, setReplace] = useState(false);
	const [decisionValidation, setDecisionValidation] = useState<string | null>(
		null,
	);
	const [validation, setValidation] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const searchQuery = useQuery({
		...metadataSearchQuery(search, searchPage),
		enabled: search.length > 0,
	});
	const details = useQuery({
		...metadataDetailQuery(reference?.provider ?? "", reference?.id ?? ""),
		enabled: Boolean(reference),
	});
	const replacement = Boolean(preview?.rows.some((row) => row.before.length));
	const invalidate = async () => {
		await client.invalidateQueries({ queryKey: ["catalog"] });
	};
	const previewAction = useMutation({
		mutationFn: previewMapping,
		onSuccess: (value) => {
			setPreview(value);
			setOperationKey(crypto.randomUUID());
			setReplace(false);
			setSuccess(null);
		},
	});
	const confirmAction = useMutation({
		mutationFn: () => {
			if (!preview) throw new Error("No preview");
			return confirmMapping({
				previewId: preview.id,
				operationKey,
				replace: replacement && replace,
			});
		},
		onSuccess: async (value) => {
			setPreview(null);
			setSuccess(value.workId);
			await invalidate();
		},
	});
	const decisionAction = useMutation({
		mutationFn: ({ reason, remove }: { reason: string; remove: boolean }) =>
			decideReview(item.id, item.revision, reason, remove),
		onSuccess: async () => {
			setPreview(null);
			setSuccess(null);
			setDecisionValidation(null);
			await invalidate();
		},
	});
	const busy =
		previewAction.isPending ||
		confirmAction.isPending ||
		decisionAction.isPending;
	function clearPreview() {
		setPreview(null);
		setValidation(null);
	}
	const existing = item.associations;
	const mappingRef = useRef<HTMLFormElement>(null);
	const previewRef = useRef<HTMLElement>(null);
	const previewId = preview?.id;
	useEffect(() => {
		if (previewId)
			previewRef.current?.scrollIntoView?.({
				behavior: "smooth",
				block: "start",
			});
	}, [previewId]);
	const loadedReference =
		reference && details.data ? `${reference.provider}:${reference.id}` : null;
	useEffect(() => {
		if (loadedReference)
			mappingRef.current?.scrollIntoView?.({
				behavior: "smooth",
				block: "start",
			});
	}, [loadedReference]);
	function episodeName(value: {
		kind: "regular" | "special" | "movie";
		number: string;
	}) {
		return value.kind === "movie"
			? t("anime.movie")
			: t(
					value.kind === "special"
						? "player.specialTitle"
						: "player.episodeTitle",
					{ number: value.number },
				);
	}
	return (
		<div className="grid min-w-0 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
			<aside className="min-w-0 space-y-4 lg:sticky lg:top-6">
				<section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
					<div className="flex items-center justify-between gap-2">
						<span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
							<FileVideo className="size-4" aria-hidden="true" />
							{t("review.source")}
						</span>
						<DecisionBadge decision={item.decision} />
					</div>
					<h2 className="font-semibold leading-relaxed wrap-anywhere">
						{item.evidence.originalName}
					</h2>
					{item.relativePath !== item.evidence.originalName && (
						<p className="text-xs leading-relaxed text-muted-foreground wrap-anywhere">
							{item.relativePath}
						</p>
					)}
					{!item.available && (
						<p
							role="alert"
							className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
						>
							{t("review.unavailable")}
						</p>
					)}
					<dl className="border-t pt-3 text-sm">
						<dt className="mb-1 text-xs text-muted-foreground">
							{t("review.rawNumbers")}
						</dt>
						<dd className="wrap-anywhere font-medium">
							{item.evidence.rawEpisodes.join(", ") || t("anime.unknown")}
						</dd>
					</dl>
					{existing.length > 0 && (
						<section className="space-y-2 border-t pt-3">
							<h3 className="text-xs text-muted-foreground">
								{t("review.current")}
							</h3>
							<ul className="space-y-2">
								{existing.map((link) => (
									<li
										key={link.episodeId}
										className="rounded-lg bg-muted/40 p-3 text-sm"
									>
										<Link
											className="font-medium hover:underline wrap-anywhere"
											to={`/anime/${encodeURIComponent(link.workId)}`}
										>
											{link.workTitle}
										</Link>
										<p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
											{episodeName(link)}
											{link.label !== episodeName(link) && ` · ${link.label}`}
										</p>
									</li>
								))}
							</ul>
						</section>
					)}
					<details className="border-t pt-3 text-xs">
						<summary className="cursor-pointer font-medium text-muted-foreground">
							{t("review.evidence")}
						</summary>
						<div className="mt-3 space-y-3 leading-relaxed text-muted-foreground">
							<p className="wrap-anywhere">
								{item.evidence.titles.join(" · ") || t("review.noMatch")}
							</p>
							{item.reason && <p className="wrap-anywhere">{item.reason}</p>}
							<ul className="space-y-2">
								{item.unresolved.map((reason) => (
									<li className="wrap-anywhere" key={reason}>
										{reason}
									</li>
								))}
							</ul>
						</div>
					</details>
				</section>
				<details className="rounded-xl border p-4 text-sm">
					<summary className="cursor-pointer font-medium text-muted-foreground">
						{t(existing.length ? "review.removeAction" : "review.reject")}
					</summary>
					<p className="mt-3 text-xs leading-relaxed text-muted-foreground">
						{t("review.rejectHint")}
					</p>
					<form
						className="mt-4 space-y-3"
						onChange={() => setDecisionValidation(null)}
						onSubmit={(event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							if (existing.length && !form.has("remove")) {
								setDecisionValidation(t("review.removeRequired"));
								return;
							}
							decisionAction.mutate({
								reason: String(form.get("reason") ?? "").trim(),
								remove: existing.length > 0,
							});
						}}
					>
						<label
							htmlFor="rejection-reason"
							className="block space-y-1.5 text-sm"
						>
							{t("review.rejectionReason")}
							<Input
								id="rejection-reason"
								name="reason"
								maxLength={500}
								required
							/>
						</label>
						{existing.length > 0 && (
							<label className="flex items-start gap-2 text-xs leading-relaxed">
								<input type="checkbox" name="remove" />
								{t("review.remove")}
							</label>
						)}
						<Button
							className="w-full text-destructive"
							type="submit"
							variant="outline"
							disabled={busy}
						>
							{t(existing.length ? "review.removeAction" : "review.reject")}
						</Button>
					</form>
					{decisionValidation && (
						<p role="alert" className="mt-3 text-sm text-destructive">
							{decisionValidation}
						</p>
					)}
					{decisionAction.error && (
						<ErrorMessage error={decisionAction.error} />
					)}
				</details>
			</aside>
			<div className="min-w-0 space-y-5">
				<section className="min-w-0 space-y-5 rounded-xl border bg-card p-4 sm:p-5">
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
										className={`flex min-w-0 flex-col gap-3 rounded-xl border p-4 ${selected ? "border-primary bg-primary/5" : "bg-background"}`}
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
												{candidate.reasons.map((reason) => (
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
												setReference(candidate.work.reference);
												clearPreview();
											}}
										>
											{selected && (
												<Check className="size-4" aria-hidden="true" />
											)}
											{t(selected ? "review.selected" : "review.select")}
										</Button>
									</li>
								);
							})}
						</ul>
					</section>

					<div className="space-y-4 border-t pt-4">
						<div className="flex items-center gap-2 text-sm font-medium">
							<Search
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
							{t("review.findAnother")}
						</div>
						<div className="grid min-w-0 gap-4 xl:grid-cols-2">
							<form
								className="flex min-w-0 items-end gap-2"
								onSubmit={(event) => {
									event.preventDefault();
									const value = String(
										new FormData(event.currentTarget).get("search") ?? "",
									).trim();
									setSearch(value);
									setSearchPage(1);
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
									const value = String(
										new FormData(event.currentTarget).get("anilistId") ?? "",
									).trim();
									const match =
										/^(?:https:\/\/anilist\.co\/anime\/)?([1-9][0-9]*)(?:\/[^?#]*)?\/?$/.exec(
											value,
										);
									if (!match?.[1]) {
										setValidation(t("review.invalidId"));
										return;
									}
									setReference({
										provider: "anilist",
										mediaType: "anime",
										id: match[1],
									});
									clearPreview();
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
														setReference(candidate.reference);
														clearPreview();
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
									<fieldset
										className="action-row"
										aria-label={t("review.search")}
									>
										<Button
											variant="outline"
											disabled={searchPage === 1 || searchQuery.isFetching}
											onClick={() => setSearchPage(searchPage - 1)}
										>
											{t("anime.previous")}
										</Button>
										<span>{t("anime.page", { page: searchPage })}</span>
										<Button
											variant="outline"
											disabled={
												!searchQuery.data.data.hasNextPage ||
												searchQuery.isFetching
											}
											onClick={() => setSearchPage(searchPage + 1)}
										>
											{t("anime.next")}
										</Button>
									</fieldset>
								</>
							)}
						</section>
					)}
				</section>
				{details.error && (
					<ErrorMessage
						error={details.error}
						retry={() => void details.refetch()}
					/>
				)}

				{reference && details.isPending && !details.error && (
					<p
						role="status"
						className="rounded-xl border p-5 text-sm text-muted-foreground"
					>
						{t("anime.loading")}
					</p>
				)}
				{!reference && (
					<div className="flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
						<span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
							2
						</span>
						<p>{t("review.chooseHint")}</p>
					</div>
				)}
				{details.data && reference && (
					<form
						key={`${reference.provider}:${reference.id}:${item.revision}`}
						ref={mappingRef}
						className="min-w-0 scroll-mt-6 space-y-4 rounded-xl border bg-card p-4 sm:p-5"
						onChange={clearPreview}
						onSubmit={(event) => {
							event.preventDefault();
							setValidation(null);
							const form = new FormData(event.currentTarget);
							const kind = String(form.get("kind")) as
								| "regular"
								| "special"
								| "movie";
							const numbers = String(form.get("numbers") ?? "")
								.split(",")
								.map((value) => value.trim())
								.filter(Boolean);
							const label = String(form.get("label") ?? "").trim();
							const reason = String(form.get("reason") ?? "").trim();
							if (
								!numbers.length ||
								!reason ||
								(kind === "regular" &&
									numbers.some((number) => !/^\d+$/.test(number))) ||
								(kind === "special" && !label)
							) {
								setValidation(t("review.invalidMapping"));
								return;
							}
							previewAction.mutate({
								reference,
								rows: [
									{
										reviewId: item.id,
										revision: item.revision,
										targets: numbers.map((number) => ({
											kind,
											number,
											...(label ? { label } : {}),
										})),
										offset: Number(form.get("offset") || 0),
										reason,
									},
								],
							});
						}}
					>
						<fieldset disabled={busy} className="space-y-4">
							<div className="flex items-center gap-2">
								<span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
									2
								</span>
								<h3 className="font-semibold">{t("review.mapEpisodes")}</h3>
							</div>
							<div className="flex min-w-0 items-start gap-4 rounded-lg bg-muted/40 p-3">
								<div className="w-14 shrink-0 overflow-hidden rounded-md">
									{details.data.data.coverUrl ? (
										<Artwork
											url={details.data.data.coverUrl}
											title={
												details.data.data.titles[0]?.value ?? t("anime.unknown")
											}
										/>
									) : (
										<div className="flex aspect-[2/3] items-center justify-center bg-muted text-muted-foreground">
											<FileVideo className="size-5" aria-hidden="true" />
										</div>
									)}
								</div>
								<div className="min-w-0 space-y-1">
									<p className="text-xs text-muted-foreground">
										{t("review.selected")}
									</p>
									<p className="font-medium wrap-anywhere">
										{details.data.data.titles[0]?.value}
									</p>
									<p className="text-xs text-muted-foreground">
										{details.data.data.format ?? t("anime.unknown")} ·{" "}
										{t("review.total", {
											count:
												details.data.data.episodeCount ?? t("anime.unknown"),
										})}
									</p>
								</div>
							</div>
							{details.data.data.description && (
								<details className="text-sm text-muted-foreground">
									<summary className="cursor-pointer">
										{t("review.synopsis")}
									</summary>
									<p className="mt-2 max-h-40 overflow-y-auto leading-relaxed wrap-anywhere">
										{details.data.data.description.replace(/<[^>]*>/g, " ")}
									</p>
								</details>
							)}
							<div className="grid min-w-0 gap-4 sm:grid-cols-2">
								<label className="flex min-w-0 flex-col gap-1.5 text-sm">
									{t("review.kind")}
									<select
										name="kind"
										className={selectStyle}
										defaultValue={
											existing[0]?.kind ??
											(details.data.data.format === "MOVIE"
												? "movie"
												: "regular")
										}
									>
										<option value="regular">{t("anime.regular")}</option>
										<option value="special">{t("anime.special")}</option>
										<option value="movie">{t("anime.movie")}</option>
									</select>
								</label>
								<label
									htmlFor="target-numbers"
									className="min-w-0 space-y-1.5 text-sm"
								>
									{t("review.numbers")}
									<Input
										id="target-numbers"
										name="numbers"
										placeholder={
											details.data.data.format === "MOVIE" ? "whole" : "1, 2, 3"
										}
										defaultValue={
											existing.length
												? existing.map((link) => link.number).join(", ")
												: details.data.data.format === "MOVIE"
													? "whole"
													: item.evidence.rawEpisodes.join(", ")
										}
										required
									/>
								</label>
								<label
									htmlFor="number-offset"
									className="min-w-0 space-y-1.5 text-sm"
								>
									{t("review.offset")}
									<Input
										id="number-offset"
										name="offset"
										type="number"
										min={-10000}
										max={10000}
										defaultValue="0"
									/>
								</label>
								<label
									htmlFor="target-label"
									className="min-w-0 space-y-1.5 text-sm"
								>
									{t("review.label")}
									<Input id="target-label" name="label" maxLength={500} />
								</label>
								<label
									htmlFor="correction-reason"
									className="min-w-0 space-y-1.5 text-sm sm:col-span-2"
								>
									{t("review.reason")}
									<Input
										id="correction-reason"
										name="reason"
										maxLength={500}
										defaultValue="Manual correction"
										required
									/>
								</label>
							</div>
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t("review.mappingHint")}
							</p>
							<Button
								className="w-full sm:w-auto"
								type="submit"
								disabled={busy || !item.available}
							>
								{t(
									previewAction.isPending
										? "review.previewing"
										: "review.preview",
								)}
							</Button>
						</fieldset>
					</form>
				)}
				{preview && (
					<section
						ref={previewRef}
						className="scroll-mt-6 space-y-4 rounded-xl border border-primary/30 bg-card p-4 sm:p-5"
					>
						<div className="flex items-center gap-2">
							<span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
								3
							</span>
							<h3 className="font-semibold">{t("review.previewTitle")}</h3>
						</div>
						{preview.rows.map((row) => (
							<div key={row.reviewId} className="space-y-3 text-sm">
								<p className="text-xs text-muted-foreground">
									{t("review.rawNumbers")}:{" "}
									{row.rawNumbers.join(", ") || t("anime.unknown")}
								</p>
								<div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
									<div className="min-w-0 space-y-2 rounded-lg border bg-background p-3">
										<p className="text-xs text-muted-foreground">
											{t("review.current")}
										</p>
										<p className="wrap-anywhere">
											{row.before
												.map(
													(link) =>
														`${existing.find((value) => value.episodeId === link.episodeId)?.workTitle ?? t("anime.unknown")} · ${episodeName(link)}`,
												)
												.join(", ") || t("review.noLinks")}
										</p>
									</div>
									<ArrowRight
										className="hidden size-4 text-muted-foreground sm:block"
										aria-hidden="true"
									/>
									<div className="min-w-0 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
										<p className="text-xs text-muted-foreground">
											{t("review.result")}
										</p>
										<p className="font-medium wrap-anywhere">
											{preview.metadata.data.titles[0]?.value ??
												t("anime.unknown")}
										</p>
										<p className="wrap-anywhere">
											{row.targets
												.map(
													(target) =>
														`${episodeName(target)}${target.label ? ` · ${target.label}` : ""}`,
												)
												.join(", ")}
										</p>
									</div>
								</div>
							</div>
						))}
						{replacement && (
							<label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-relaxed">
								<input
									type="checkbox"
									checked={replace}
									onChange={(event) => setReplace(event.target.checked)}
								/>
								{t("review.replace")}
							</label>
						)}
						<Button
							disabled={busy || (replacement && !replace) || !item.available}
							onClick={() => confirmAction.mutate()}
						>
							{t(confirmAction.isPending ? "review.saving" : "review.confirm")}
						</Button>
					</section>
				)}
				{validation && <p role="alert">{validation}</p>}
				{previewAction.error && <ErrorMessage error={previewAction.error} />}
				{confirmAction.error && <ErrorMessage error={confirmAction.error} />}

				{success && (
					<p
						role="status"
						className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"
					>
						{t("review.saved")}{" "}
						<Link
							to={`/anime/${encodeURIComponent(success)}`}
							className="underline"
						>
							{t("review.openWork")}
						</Link>
					</p>
				)}
			</div>
		</div>
	);
}

function ErrorMessage({
	error,
	retry,
}: {
	error: unknown;
	retry?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div
			role="alert"
			className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
		>
			<p>{t(getErrorTranslationKey(error) ?? "errors.requestFailed")}</p>
			{retry && (
				<Button variant="outline" onClick={retry}>
					{t("actions.retry")}
				</Button>
			)}
		</div>
	);
}
