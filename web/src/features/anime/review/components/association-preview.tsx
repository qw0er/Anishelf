import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Checkbox } from "../../../../shared/components/ui/checkbox.js";
import { FieldLabel } from "../../../../shared/components/ui/field.js";
import { episodeName } from "../../shared/episode-name.js";
import type { ReviewController } from "../use-review-controller.js";

export function AssociationPreview({
	item,
	controller,
}: {
	item: CatalogReviewItem;
	controller: Pick<
		ReviewController,
		| "preview"
		| "replacement"
		| "replace"
		| "busy"
		| "confirmPending"
		| "confirm"
		| "allowReplacement"
	>;
}) {
	const { t } = useTranslation();
	const {
		preview,
		replacement,
		replace,
		busy,
		confirmPending,
		confirm,
		allowReplacement,
	} = controller;
	const existing = item.associations;
	const previewRef = useRef<HTMLElement>(null);
	const previewId = preview?.id;
	useEffect(() => {
		if (previewId)
			previewRef.current?.scrollIntoView?.({
				behavior: "smooth",
				block: "start",
			});
	}, [previewId]);
	if (!preview) return null;
	return (
		<section
			ref={previewRef}
			className="scroll-mt-6 space-y-4 rounded-lg border border-primary/30 bg-card p-4 sm:p-5"
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
											`${existing.find((value) => value.episodeId === link.episodeId)?.workTitle ?? t("anime.unknown")} · ${episodeName(link, t)}`,
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
								{preview.metadata.data.titles[0]?.value ?? t("anime.unknown")}
							</p>
							<p className="wrap-anywhere">
								{row.targets
									.map(
										(target) =>
											`${episodeName(target, t)}${target.label ? ` · ${target.label}` : ""}`,
									)
									.join(", ")}
							</p>
						</div>
					</div>
				</div>
			))}
			{replacement && (
				<div className="touch-control flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm leading-relaxed">
					<Checkbox
						id="replace-association"
						checked={replace}
						onCheckedChange={allowReplacement}
					/>
					<FieldLabel
						className="touch-control flex-1"
						htmlFor="replace-association"
					>
						{t("review.replace")}
					</FieldLabel>
				</div>
			)}
			<Button
				disabled={busy || (replacement && !replace) || !item.available}
				onClick={() => confirm()}
			>
				{t(confirmPending ? "review.saving" : "review.confirm")}
			</Button>
		</section>
	);
}
