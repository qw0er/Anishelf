import { workReference } from "@anishelf/backend/contracts/references";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { libraryReturnPath } from "../../../../shared/navigation.js";
import { metadataDetailQuery } from "../../metadata/public.js";
import { Artwork } from "../../shared/components/artwork.js";
import { useViewingState, ViewingSummary } from "../../tracking/public.js";
import { WorkMetadataHeader } from "./work-metadata-header.js";
import { WorkSynopsis } from "./work-synopsis.js";
export function TrackedAnimeDetail() {
	const { mediaId = "" } = useParams();
	const [params] = useSearchParams();
	const { t } = useTranslation();
	const reference = workReference(mediaId);
	const metadata = useQuery(
		metadataDetailQuery(reference.provider, reference.id),
	);
	const viewing = useViewingState(mediaId);
	const info = metadata.data?.data;
	const summary = viewing.snapshot?.entry;
	const title = summary?.titles[0] ?? info?.titles[0]?.value ?? mediaId;
	return (
		<section className="stack-page">
			<Link
				className={buttonStyles("outline")}
				to={libraryReturnPath(params.get("library"))}
				state={{ focusWork: mediaId }}
			>
				{t("anime.back")}
			</Link>
			<p className="surface-panel">{t("trackingList.noLocal")}</p>
			{metadata.data && info ? (
				<>
					<Artwork url={info.bannerUrl} title={title} banner />
					<WorkMetadataHeader
						viewing={
							<ViewingSummary
								state={viewing}
								episodeCount={info.episodeCount}
							/>
						}
						data={{
							work: {
								displayTitle: title,
								coverUrl: summary?.coverUrl ?? info.coverUrl,
								format: info.format,
								year: info.year,
								episodeCount: info.episodeCount,
								reference: info.reference,
							},
							metadata: metadata.data,
						}}
					/>
					<WorkSynopsis data={{ metadata: metadata.data }} />
				</>
			) : (
				<>
					<h1 className="page-title">{title}</h1>
					<ViewingSummary state={viewing} />
					{summary && (
						<div className="w-32">
							<Artwork url={summary.coverUrl} title={title} />
						</div>
					)}
					{metadata.error ? (
						<div role="alert">
							<p>{t("errors.pageLoad")}</p>
							<Button variant="outline" onClick={() => void metadata.refetch()}>
								{t("actions.retry")}
							</Button>
						</div>
					) : (
						<p role="status">{t("anime.loading")}</p>
					)}
				</>
			)}
		</section>
	);
}
