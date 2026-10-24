import { FileVideo } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Input } from "../../../../shared/components/ui/input.js";
import { Artwork } from "../../shared/components/artwork.js";
import { mappingDefaults } from "../mapping-defaults.js";
import type { ReviewController } from "../use-review-controller.js";

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
	const defaults = mappingDefaults(
		item,
		reference,
		details.data.data.format,
		details.data.data.episodeCount,
	);
	return (
		<form
			key={`${reference.provider}:${reference.id}:${item.revision}`}
			ref={mappingRef}
			className="min-w-0 scroll-mt-6 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
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
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">{t("review.kind")}</legend>
						<div className="flex flex-wrap gap-3">
							{(["regular", "special", "movie"] as const).map((value) => (
								<label key={value} className="flex items-center gap-2 text-sm">
									<input
										type="radio"
										name="kind"
										value={value}
										defaultChecked={defaults.kind === value}
										className="accent-primary"
									/>
									{t(`anime.${value}`)}
								</label>
							))}
						</div>
					</fieldset>
					<label
						htmlFor="target-numbers"
						className="min-w-0 space-y-1.5 text-sm"
					>
						{t("review.numbers")}
						<Input
							id="target-numbers"
							name="numbers"
							placeholder={
								details.data.data.format === "MOVIE"
									? t("review.whole")
									: t("review.numbersPlaceholder")
							}
							defaultValue={defaults.numbers}
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
							defaultValue={defaults.offset}
						/>
					</label>
					<label htmlFor="target-label" className="min-w-0 space-y-1.5 text-sm">
						{t("review.label")}
						<Input
							id="target-label"
							name="label"
							maxLength={500}
							defaultValue={defaults.label}
						/>
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
							defaultValue={t("review.manualCorrection")}
							required
						/>
					</label>
				</div>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{t("review.mappingHint")}
				</p>
				{defaults.offset !== 0 && (
					<p className="text-sm text-muted-foreground">
						{defaults.mappingReasons.join(" ")}
					</p>
				)}
				{defaults.kind === "special" && (
					<p className="text-sm text-muted-foreground">
						{t("review.specialHint")}
					</p>
				)}
				{!defaults.numbers && (
					<p className="text-sm text-muted-foreground">
						{t("review.unknownNumbering")}
					</p>
				)}
				{defaults.reasons.length > 0 && (
					<ul className="space-y-1 text-sm text-muted-foreground">
						{defaults.reasons.map((reason) => (
							<li key={reason}>{reason}</li>
						))}
					</ul>
				)}
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
