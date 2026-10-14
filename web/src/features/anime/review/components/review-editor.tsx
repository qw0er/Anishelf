import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { ErrorMessage } from "../../shared/components/error-message.js";
import { reviewQuery } from "../queries.js";
import { useReviewController } from "../use-review-controller.js";
import { AssociationPreview } from "./association-preview.js";
import { CandidateSelection } from "./candidate-selection.js";
import { MappingForm } from "./mapping-form.js";
import { RejectionPanel } from "./rejection-panel.js";
import { SourceSummary } from "./source-summary.js";
export function ReviewEditor({ id }: { id: string }) {
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
	const controller = useReviewController(item);
	const {
		reference,
		details,
		preview,
		validation,
		previewError,
		confirmError,
		success,
	} = controller;
	return (
		<div className="grid min-w-0 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
			<aside className="min-w-0 space-y-4 lg:sticky lg:top-6">
				<SourceSummary item={item} />
				<RejectionPanel item={item} controller={controller} />
			</aside>
			<div className="min-w-0 space-y-5">
				<CandidateSelection item={item} controller={controller} />
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
					<MappingForm item={item} controller={controller} />
				)}
				{preview && <AssociationPreview item={item} controller={controller} />}
				{validation && <p role="alert">{validation}</p>}
				{previewError && <ErrorMessage error={previewError} />}
				{confirmError && <ErrorMessage error={confirmError} />}

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
