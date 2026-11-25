import { workKey } from "@anishelf/contracts/references";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import type { AnimeDetailResponse } from "../../../../shared/api/contracts.js";
import {
	queryScopeIdentity,
	useQueryScope,
} from "../../../../shared/api/queries.js";
import {
	LoadFailure,
	queryLoadFailure,
} from "../../../../shared/components/load-failure.js";
import { buttonStyles } from "../../../../shared/components/ui/button.js";
import { libraryReturnPath } from "../../../../shared/navigation.js";
import { airingQuery } from "../../metadata/public.js";
import { Artwork } from "../../shared/components/artwork.js";
import { useDetailViewing, ViewingSummary } from "../../tracking/public.js";
import { animeDetailQuery } from "../detail-query.js";
import type { AnimeEpisodeActionSlot } from "../resource-actions.js";
import { type AnimeStatusState, animeStatusQuery } from "../status-query.js";
import { useEpisodeTimeline } from "../use-episode-timeline.js";
import { AiringStatus } from "./airing-status.js";
import { EpisodeRows } from "./episode-rows.js";
import { RelatedWorks } from "./related-works.js";
import { WorkMetadataExtras } from "./work-metadata-extras.js";
import { WorkMetadataHeader } from "./work-metadata-header.js";
import { WorkSynopsis } from "./work-synopsis.js";
export function TrackedAnimeDetail({
	renderSubscription,
	renderEpisodeAction,
}: {
	renderSubscription?: (workKey: string, detail: AnimeStatusState) => ReactNode;
	renderEpisodeAction?: AnimeEpisodeActionSlot;
} = {}) {
	const { mediaId = "", metadataId } = useParams();
	const [params] = useSearchParams();
	const { t } = useTranslation();
	const scope = useQueryScope();
	const query = useQuery(
		animeDetailQuery(
			metadataId ?? mediaId,
			scope,
			metadataId ? "metadata" : "work",
		),
	);
	const failure = queryLoadFailure(query);
	const library = params.get("library");
	if (!query.data)
		return (
			<section className="stack-page">
				{failure ? (
					<LoadFailure message={t("errors.workLoad")} {...failure}>
						<Link
							className={buttonStyles("outline")}
							to={libraryReturnPath(library)}
						>
							{t("anime.back")}
						</Link>
					</LoadFailure>
				) : (
					<p role="status">{t("anime.loading")}</p>
				)}
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
			key={JSON.stringify([
				queryScopeIdentity(scope),
				metadataId ?? mediaId,
				workKey(query.data.reference),
			])}
			data={query.data}
			retry={query.refetch}
			fetchStatus={query.fetchStatus}
			library={library}
			{...(renderSubscription ? { renderSubscription } : {})}
			{...(renderEpisodeAction ? { renderEpisodeAction } : {})}
		/>
	);
}
function TrackedDetail({
	data,
	retry,
	fetchStatus,
	library,
	renderSubscription,
	renderEpisodeAction,
}: {
	data: AnimeDetailResponse;
	retry: () => Promise<unknown>;
	fetchStatus: "idle" | "fetching" | "paused";
	library: string | null;
	renderSubscription?: (workKey: string, detail: AnimeStatusState) => ReactNode;
	renderEpisodeAction?: AnimeEpisodeActionSlot;
}) {
	const { t } = useTranslation();
	const mediaId = workKey(data.reference);
	const airing = useInfiniteQuery({
		...airingQuery(data.metadata?.data.reference.id ?? ""),
		enabled: Boolean(data.metadata),
	});
	const timeline = useEpisodeTimeline(
		mediaId,
		data.metadata,
		[],
		airing.data?.pages ?? [],
	);
	const status = useQuery(animeStatusQuery(mediaId, useQueryScope()));
	const viewing = useDetailViewing(
		status.data?.viewing,
		mediaId,
		() => {
			void status.refetch();
		},
		status.error,
	);
	const metadata = data.metadata;
	const failure = data.metadataError;
	const [retries, setRetries] = useState(0);
	const retryAt = failure?.retryAt ?? null;
	const failureCode = failure?.code;
	const retryScheduled =
		!metadata &&
		retries < 2 &&
		(failureCode === "unavailable" ||
			failureCode === "storage-unavailable" ||
			failureCode === "busy" ||
			(failureCode === "rate-limited" && retryAt !== null));

	useEffect(() => {
		if (!retryScheduled || fetchStatus !== "idle") return;
		const delay = Math.max(1000 * 2 ** retries, (retryAt ?? 0) - Date.now());
		const timer = setTimeout(() => {
			console.debug("UI metadata retry requested", {
				attempt: retries + 1,
				code: failureCode,
			});
			setRetries(retries + 1);
			void retry();
		}, delay);
		return () => clearTimeout(timer);
	}, [retryScheduled, fetchStatus, retries, retryAt, failureCode, retry]);

	let retryState: ComponentProps<typeof LoadFailure>["retryState"];
	if (fetchStatus === "paused") retryState = "offline";
	else if (fetchStatus === "fetching") retryState = "retrying";
	else if (retryScheduled) retryState = "scheduled";
	let failureDetail: string | undefined;
	if (failureCode === "not-found") failureDetail = t("errors.metadataNotFound");
	else if (failureCode === "rate-limited")
		failureDetail = t("errors.metadataRateLimited");

	// Provider images are proxied so they share the backend artwork cache and HTTP policy.
	const artwork = (kind: "cover" | "banner") =>
		kind === "cover"
			? (data.metadata?.data.coverUrl ?? null)
			: (data.metadata?.data.bannerUrl ?? null);
	const info = metadata?.data;
	const summary = viewing.snapshot?.entry;
	const title = info
		? data.displayTitle
		: (summary?.titles[0] ?? data.displayTitle);
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
			{metadata && info ? (
				<>
					<WorkMetadataHeader
						airedCount={timeline.aired}
						bannerUrl={info.bannerUrl ? artwork("banner") : null}
						subscription={renderSubscription?.(mediaId, status)}
						viewing={
							<ViewingSummary
								state={viewing}
								episodeCount={info.episodeCount}
								airedEpisodeCount={timeline.aired}
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
							metadata,
						}}
					/>
					<section className="space-y-3">
						<h2 className="section-title-prominent">{t("anime.episodes")}</h2>
						<EpisodeRows
							episodes={timeline.episodes}
							workKey={mediaId}
							trackingProgress={summary?.progress ?? null}
							{...(renderEpisodeAction ? { renderEpisodeAction } : {})}
						/>
					</section>
					<AiringStatus query={airing} metadata={data.metadata} />
					<WorkSynopsis data={{ metadata }} />
					<WorkMetadataExtras data={{ metadata }} />
					<RelatedWorks
						key={info.reference.id}
						workId={info.reference.id}
						libraryPath={libraryReturnPath(library)}
					/>
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
					{failure ? (
						<LoadFailure
							message={t("errors.metadataLoad")}
							detail={failureDetail}
							retryState={retryState}
							retry={() => {
								setRetries(0);
								void retry();
							}}
						/>
					) : (
						<p role="status">{t("anime.loading")}</p>
					)}
				</>
			)}
			{!metadata && renderSubscription?.(mediaId, status)}
		</section>
	);
}
