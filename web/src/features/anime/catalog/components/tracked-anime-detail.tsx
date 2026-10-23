import { workKey } from "@anishelf/backend/contracts/references";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import type { AnimeDetailResponse } from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { libraryReturnPath } from "../../../../shared/navigation.js";
import { Artwork } from "../../shared/components/artwork.js";
import { useDetailViewing, ViewingSummary } from "../../tracking/public.js";
import { airedEpisodeCount } from "../detail-format.js";
import { animeDetailQuery } from "../detail-query.js";
import { WorkMetadataExtras } from "./work-metadata-extras.js";
import { WorkMetadataHeader } from "./work-metadata-header.js";
import { WorkSynopsis } from "./work-synopsis.js";
export function TrackedAnimeDetail({
	renderSubscription,
}: {
	renderSubscription?: (
		workKey: string,
		detail: Pick<AnimeDetailResponse, "subscription" | "downloads">,
	) => ReactNode;
} = {}) {
	const { mediaId = "" } = useParams();
	const [params] = useSearchParams();
	const { t } = useTranslation();
	const scope = useQueryScope();
	const query = useQuery(animeDetailQuery(mediaId, scope));
	if (!query.data)
		return (
			<section className="stack-page">
				<p role={query.error ? "alert" : "status"}>
					{t(query.error ? "errors.pageLoad" : "anime.loading")}
				</p>
				<Button onClick={() => void query.refetch()}>
					{t("actions.retry")}
				</Button>
			</section>
		);
	return (
		<TrackedDetail
			data={query.data}
			retry={() => void query.refetch()}
			library={params.get("library")}
			{...(renderSubscription ? { renderSubscription } : {})}
		/>
	);
}
function TrackedDetail({
	data,
	retry,
	library,
	renderSubscription,
}: {
	data: AnimeDetailResponse;
	retry: () => void;
	library: string | null;
	renderSubscription?: (
		workKey: string,
		detail: Pick<AnimeDetailResponse, "subscription" | "downloads">,
	) => ReactNode;
}) {
	const { t } = useTranslation();
	const mediaId = workKey(data.reference);
	const viewing = useDetailViewing(data.viewing, mediaId, retry);
	const metadata = {
		data: data.metadata,
		error: data.metadataError,
		refetch: retry,
	};
	const info = data.metadata?.data;
	const summary = viewing.snapshot?.entry;
	const title = data.displayTitle;
	return (
		<section className="stack-page">
			<Link
				className={buttonStyles("outline")}
				to={libraryReturnPath(library)}
				state={{ focusWork: mediaId }}
			>
				{t("anime.back")}
			</Link>
			<p className="surface-panel">{t("trackingList.noLocal")}</p>
			{metadata.data && info ? (
				<>
					<Artwork url={info.bannerUrl} title={title} banner />
					<WorkMetadataHeader
						subscription={renderSubscription?.(mediaId, data)}
						viewing={
							<ViewingSummary
								state={viewing}
								episodeCount={info.episodeCount}
								airedEpisodeCount={airedEpisodeCount(info)}
							/>
						}
						data={{
							work: {
								displayTitle: title,
								coverUrl: info.coverUrl,
								format: info.format,
								year: info.year,
								episodeCount: info.episodeCount,
								reference: info.reference,
							},
							metadata: metadata.data,
						}}
					/>
					<WorkSynopsis data={{ metadata: metadata.data }} />
					<WorkMetadataExtras data={{ metadata: metadata.data }} />
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
			{!metadata.data && renderSubscription?.(mediaId, data)}
		</section>
	);
}
