import { workKey } from "@anishelf/backend/contracts/references";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
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
import { type AnimeStatusState, animeStatusQuery } from "../status-query.js";
import { WorkMetadataExtras } from "./work-metadata-extras.js";
import { WorkMetadataHeader } from "./work-metadata-header.js";
import { WorkSynopsis } from "./work-synopsis.js";
export function TrackedAnimeDetail({
	renderSubscription,
}: {
	renderSubscription?: (workKey: string, detail: AnimeStatusState) => ReactNode;
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
	if (query.data.local)
		return (
			<Navigate
				replace
				to={{
					pathname: `/anime/${encodeURIComponent(query.data.local.work.id)}`,
					search: params.toString() ? `?${params}` : "",
				}}
			/>
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
	renderSubscription?: (workKey: string, detail: AnimeStatusState) => ReactNode;
}) {
	const { t } = useTranslation();
	const mediaId = workKey(data.reference);
	const status = useQuery(animeStatusQuery(mediaId, useQueryScope()));
	const viewing = useDetailViewing(
		status.data?.viewing,
		mediaId,
		() => {
			void status.refetch();
		},
		status.error,
	);
	const metadata = {
		data: data.metadata,
		error: data.metadataError,
		refetch: retry,
	};
	// Provider images are proxied so they share the backend artwork cache and HTTP policy.
	const artwork = (kind: "cover" | "banner") =>
		kind === "cover"
			? (data.metadata?.data.coverUrl ?? null)
			: (data.metadata?.data.bannerUrl ?? null);
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
					<WorkMetadataHeader
						bannerUrl={info.bannerUrl ? artwork("banner") : null}
						subscription={renderSubscription?.(mediaId, status)}
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
								coverUrl: info.coverUrl ? artwork("cover") : null,
								format: info.format,
								year: info.year,
								episodeCount: info.episodeCount,
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
			{!metadata.data && renderSubscription?.(mediaId, status)}
		</section>
	);
}
