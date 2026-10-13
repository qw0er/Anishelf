import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { IdentificationStatus } from "./identification-status.js";

const selectStyle =
	"h-9 max-w-full rounded-md border bg-background px-2 text-sm";
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
	return (
		<section className="stack-page">
			<h1 className="page-title">{t("review.title")}</h1>
			<IdentificationStatus />
			<p className="text-sm text-muted-foreground">{t("review.hint")}</p>
			{item ? (
				<ReviewEditor key={`${item}:${scope}`} id={item} />
			) : (
				<>
					<label className="flex flex-col gap-1 text-sm">
						{t("review.decision")}
						<select
							className={selectStyle}
							value={decision}
							onChange={(event) => setParams({ decision: event.target.value })}
						>
							{["pending", "confirmed", "rejected"].map((value) => (
								<option key={value} value={value}>
									{t(`review.${value}`)}
								</option>
							))}
						</select>
					</label>
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
								<ul className="divide-y rounded-lg border px-4">
									{query.data.items.map((row) => (
										<li
											key={row.id}
											className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
										>
											<div className="min-w-0 flex-1">
												<p className="wrap-anywhere font-medium">
													{row.relativePath}
												</p>
												<p className="text-sm text-muted-foreground">
													{t(`review.${row.decision}`)}
													{!row.available && ` · ${t("anime.unavailable")}`}
												</p>
												{row.associations.length > 0 && (
													<p className="text-sm wrap-anywhere">
														{row.associations
															.map((link) => `${link.workTitle}: ${link.label}`)
															.join(" · ")}
													</p>
												)}
											</div>
											<Link
												className={buttonStyles("outline")}
												to={`/review?${new URLSearchParams({ item: row.id, decision, page: String(page) })}`}
											>
												{t(
													row.decision === "confirmed"
														? "review.correct"
														: "review.inspect",
												)}
											</Link>
										</li>
									))}
								</ul>
							) : (
								<p role="status">{t("review.empty")}</p>
							)}
							<fieldset
								className="action-row"
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
								<span>{t("anime.page", { page })}</span>
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
	return (
		<>
			<Link to="/review" className={buttonStyles("outline")}>
				{t("review.back")}
			</Link>
			{query.data ? (
				<MappingEditor key={id} item={query.data} />
			) : query.error ? (
				<ErrorMessage error={query.error} retry={() => void query.refetch()} />
			) : (
				<p role="status">{t("anime.loading")}</p>
			)}
		</>
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
	return (
		<div className="space-y-6">
			<h2 className="text-lg font-semibold wrap-anywhere">
				{item.evidence.originalName}
			</h2>
			<p className="text-sm wrap-anywhere">{item.relativePath}</p>
			<p className="text-sm text-muted-foreground">
				{t(`review.${item.decision}`)} · {item.reason}
			</p>
			{!item.available && <p role="alert">{t("review.unavailable")}</p>}
			{existing.length > 0 && (
				<section className="space-y-2">
					<h3 className="font-medium">{t("review.current")}</h3>
					<ul>
						{existing.map((link) => (
							<li key={link.episodeId}>
								<Link
									className="underline"
									to={`/anime/${encodeURIComponent(link.workId)}`}
								>
									{link.workTitle}
								</Link>
								: {link.label} ({link.kind} {link.number})
							</li>
						))}
					</ul>
				</section>
			)}
			<details>
				<summary className="cursor-pointer">{t("review.evidence")}</summary>
				<p className="text-sm wrap-anywhere">
					{item.evidence.titles.join(" · ")} · {t("review.rawNumbers")}:{" "}
					{item.evidence.rawEpisodes.join(", ") || t("anime.unknown")}
				</p>
				<ul className="list-disc pl-5 text-sm">
					{item.unresolved.map((reason) => (
						<li key={reason}>{reason}</li>
					))}
				</ul>
			</details>
			<section className="space-y-3">
				<h3 className="font-medium">{t("review.candidates")}</h3>
				{item.proposals.length === 0 && <p>{t("review.noCandidates")}</p>}
				<ul className="space-y-3">
					{item.proposals.map((proposal) => (
						<li
							key={`${proposal.candidate.work.reference.provider}:${proposal.candidate.work.reference.id}`}
							className="space-y-2 rounded-lg border p-3"
						>
							<p className="font-medium wrap-anywhere">
								{proposal.candidate.work.titles[0]} ·{" "}
								{proposal.candidate.work.format ?? t("anime.unknown")} ·{" "}
								{proposal.candidate.work.year ?? t("anime.unknown")}
							</p>
							<p className="text-sm">
								{t("review.rank", { score: proposal.candidate.score })}
							</p>
							<ul className="text-sm">
								{[
									...proposal.candidate.reasons,
									...proposal.candidate.conflicts,
									...proposal.mapping.unresolved,
								].map((reason) => (
									<li key={reason}>{reason}</li>
								))}
							</ul>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => {
									setReference(proposal.candidate.work.reference);
									clearPreview();
								}}
							>
								{t("review.select")}
							</Button>
						</li>
					))}
				</ul>
			</section>
			<form
				className="action-row"
				onSubmit={(event) => {
					event.preventDefault();
					const value = String(
						new FormData(event.currentTarget).get("search") ?? "",
					).trim();
					setSearch(value);
					setSearchPage(1);
				}}
			>
				<label htmlFor="candidate-search" className="min-w-0 flex-1 text-sm">
					{t("review.search")}
					<Input id="candidate-search" name="search" maxLength={200} required />
				</label>
				<Button type="submit" disabled={busy}>
					{t("review.searchAction")}
				</Button>
			</form>
			<form
				className="action-row"
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
				<label htmlFor="provider-id" className="min-w-0 flex-1 text-sm">
					{t("review.providerId")}
					<Input id="provider-id" name="anilistId" disabled={busy} required />
				</label>
				<Button type="submit" variant="outline" disabled={busy}>
					{t("review.lookup")}
				</Button>
			</form>
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
										className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
									>
										<p className="min-w-0 flex-1 wrap-anywhere">
											{candidate.titles[0]?.value ?? t("anime.unknown")} ·{" "}
											{candidate.format ?? t("anime.unknown")} ·{" "}
											{candidate.year ?? t("anime.unknown")}
										</p>
										<Button
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
							<fieldset className="action-row" aria-label={t("review.search")}>
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
										!searchQuery.data.data.hasNextPage || searchQuery.isFetching
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
			{details.error && (
				<ErrorMessage
					error={details.error}
					retry={() => void details.refetch()}
				/>
			)}
			{details.data && reference && (
				<form
					key={`${reference.provider}:${reference.id}:${item.revision}`}
					className="space-y-3 rounded-lg border p-4"
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
					<fieldset disabled={busy} className="space-y-3">
						<h3 className="font-semibold">
							{t("review.selected")}: {details.data.data.titles[0]?.value}
						</h3>
						<p className="text-sm">
							{details.data.data.format ?? t("anime.unknown")} ·{" "}
							{t("review.total", {
								count: details.data.data.episodeCount ?? t("anime.unknown"),
							})}
						</p>
						<p className="text-sm text-muted-foreground">
							{details.data.data.description?.replace(/<[^>]*>/g, " ")}
						</p>
						<label className="flex flex-col gap-1 text-sm">
							{t("review.kind")}
							<select
								name="kind"
								className={selectStyle}
								defaultValue={
									existing[0]?.kind ??
									(details.data.data.format === "MOVIE" ? "movie" : "regular")
								}
							>
								<option value="regular">{t("anime.regular")}</option>
								<option value="special">{t("anime.special")}</option>
								<option value="movie">{t("anime.movie")}</option>
							</select>
						</label>
						<label htmlFor="target-numbers" className="block text-sm">
							{t("review.numbers")}
							<Input
								id="target-numbers"
								name="numbers"
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
						<label htmlFor="number-offset" className="block text-sm">
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
						<label htmlFor="target-label" className="block text-sm">
							{t("review.label")}
							<Input id="target-label" name="label" maxLength={500} />
						</label>
						<label htmlFor="correction-reason" className="block text-sm">
							{t("review.reason")}
							<Input
								id="correction-reason"
								name="reason"
								maxLength={500}
								defaultValue="Manual correction"
								required
							/>
						</label>
						<Button type="submit" disabled={busy || !item.available}>
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
				<section className="space-y-3 rounded-lg border p-4">
					<h3 className="font-semibold">{t("review.previewTitle")}</h3>
					{preview.rows.map((row) => (
						<div key={row.reviewId} className="text-sm space-y-2">
							<p className="wrap-anywhere">{row.relativePath}</p>
							<p>
								{t("review.rawNumbers")}:{" "}
								{row.rawNumbers.join(", ") || t("anime.unknown")}
							</p>
							<p>
								{t("review.current")}:{" "}
								{row.before
									.map((link) => `${link.workId}: ${link.kind} ${link.number}`)
									.join(", ") || t("review.noLinks")}
							</p>
							<p>
								{t("review.result")}:{" "}
								{row.targets
									.map(
										(target) =>
											`${target.kind} ${target.number}${target.label ? ` (${target.label})` : ""}`,
									)
									.join(", ")}
							</p>
						</div>
					))}
					{replacement && (
						<label className="flex items-start gap-2 text-sm">
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
			{decisionAction.error && <ErrorMessage error={decisionAction.error} />}
			{success && (
				<p role="status">
					{t("review.saved")}{" "}
					<Link
						to={`/anime/${encodeURIComponent(success)}`}
						className="underline"
					>
						{t("review.openWork")}
					</Link>
				</p>
			)}
			<form
				className="space-y-3 border-t pt-4"
				onSubmit={(event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					if (existing.length && !form.has("remove")) {
						setValidation(t("review.removeRequired"));
						return;
					}
					decisionAction.mutate({
						reason: String(form.get("reason") ?? "").trim(),
						remove: existing.length > 0,
					});
				}}
			>
				<label htmlFor="rejection-reason" className="block text-sm">
					{t("review.rejectionReason")}
					<Input id="rejection-reason" name="reason" maxLength={500} required />
				</label>
				{existing.length > 0 && (
					<label className="flex items-start gap-2 text-sm">
						<input type="checkbox" name="remove" />
						{t("review.remove")}
					</label>
				)}
				<Button type="submit" variant="outline" disabled={busy}>
					{t(existing.length ? "review.removeAction" : "review.reject")}
				</Button>
			</form>
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
		<div role="alert" className="space-y-2">
			<p>{t(getErrorTranslationKey(error) ?? "errors.requestFailed")}</p>
			{retry && (
				<Button variant="outline" onClick={retry}>
					{t("actions.retry")}
				</Button>
			)}
		</div>
	);
}
