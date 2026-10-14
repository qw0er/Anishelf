import { FileVideo } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Input } from "../../../../shared/components/ui/input.js";
import { Artwork } from "../../shared/components/artwork.js";
import type { ReviewController } from "../use-review-controller.js";

const selectStyle =
	"h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring";
export function MappingForm({
	item,
	controller,
}: {
	item: CatalogReviewItem;
	controller: Pick<
		ReviewController,
		| "reference"
		| "details"
		| "busy"
		| "clearPreview"
		| "requestPreview"
		| "previewPending"
	>;
}) {
	const { t } = useTranslation();
	const {
		reference,
		details,
		busy,
		clearPreview,
		requestPreview,
		previewPending,
	} = controller;
	const existing = item.associations;
	const mappingRef = useRef<HTMLFormElement>(null);
	const loadedReference =
		reference && details.data ? `${reference.provider}:${reference.id}` : null;
	useEffect(() => {
		if (loadedReference)
			mappingRef.current?.scrollIntoView?.({
				behavior: "smooth",
				block: "start",
			});
	}, [loadedReference]);
	if (!reference || !details.data) return null;
	return (
		<form
			key={`${reference.provider}:${reference.id}:${item.revision}`}
			ref={mappingRef}
			className="min-w-0 scroll-mt-6 space-y-4 rounded-xl border bg-card p-4 sm:p-5"
			onChange={clearPreview}
			onSubmit={(event) => {
				event.preventDefault();
				requestPreview(new FormData(event.currentTarget));
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
								title={details.data.data.titles[0]?.value ?? t("anime.unknown")}
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
								count: details.data.data.episodeCount ?? t("anime.unknown"),
							})}
						</p>
					</div>
				</div>
				{details.data.data.description && (
					<details className="text-sm text-muted-foreground">
						<summary className="cursor-pointer">{t("review.synopsis")}</summary>
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
								(details.data.data.format === "MOVIE" ? "movie" : "regular")
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
					<label htmlFor="target-label" className="min-w-0 space-y-1.5 text-sm">
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
					{t(previewPending ? "review.previewing" : "review.preview")}
				</Button>
			</fieldset>
		</form>
	);
}
