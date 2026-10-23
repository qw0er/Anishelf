import { workKey } from "@anishelf/backend/contracts/references";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type {
	AnimeDetailResponse,
	LocalWorkDetailResponse,
} from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Skeleton } from "../../../../shared/components/ui/skeleton.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import { airingQuery } from "../../metadata/public.js";
import { Artwork } from "../../shared/components/artwork.js";
import {
	episodeViewing,
	useDetailViewing,
	ViewingSummary,
} from "../../tracking/public.js";
import { airedEpisodeCount } from "../detail-format.js";
import { nextPlayableEpisode } from "../next-playback.js";
import { localWorkDetailQuery } from "../queries.js";
import type { AnimeResourceActionSlot } from "../resource-actions.js";

import { useLocalWorkDetail } from "../use-local-work-detail.js";
import { AiringStatus } from "./airing-status.js";
import { EpisodeList } from "./episode-list.js";
import { PlayNextButton } from "./play-next-button.js";
import { RelatedWorks } from "./related-works.js";
import { VersionSelector } from "./version-selector.js";
import { WorkMetadataExtras } from "./work-metadata-extras.js";
import { WorkMetadataHeader } from "./work-metadata-header.js";
import { WorkSynopsis } from "./work-synopsis.js";
export function AnimeDetail({
	renderResourceActions,
	renderSubscription,
}: {
	renderResourceActions: AnimeResourceActionSlot;
	renderSubscription?: (
		workKey: string,
		detail: Pick<AnimeDetailResponse, "subscription" | "downloads">,
	) => ReactNode;
}) {
	const { id = "" } = useParams();
	const scope = useQueryScope();
	const query = useQuery(localWorkDetailQuery(id, scope));
	const { t } = useTranslation();
	if (!query.data)
		return query.error ? (
			<section className="stack-page">
				<p role="alert">
					{t(getErrorTranslationKey(query.error) ?? "errors.pageLoad")}
				</p>
				<Button variant="outline" onClick={() => void query.refetch()}>
					{t("actions.retry")}
				</Button>
				<Link to="/" className={buttonStyles("outline")}>
					{t("anime.back")}
				</Link>
			</section>
		) : (
			<div role="status" aria-label={t("anime.loading")}>
				<Skeleton className="h-64 w-full" />
			</div>
		);
	return (
		<LocalWorkDetail
			key={`${id}:${scope}`}
			data={query.data}
			renderResourceActions={renderResourceActions}
			{...(renderSubscription ? { renderSubscription } : {})}
		/>
	);
}
function LocalWorkDetail({
	data,
	renderResourceActions,
	renderSubscription,
}: {
	data: LocalWorkDetailResponse & { detail: AnimeDetailResponse };
	renderResourceActions: AnimeResourceActionSlot;
	renderSubscription?: (
		workKey: string,
		detail: Pick<AnimeDetailResponse, "subscription" | "downloads">,
	) => ReactNode;
}) {
	const { t, i18n } = useTranslation();
	const controller = useLocalWorkDetail(data);
	const { libraryPath, refresh } = controller;
	const { work, metadata } = data;
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const handledPlay = useRef<string | null>(null);
	const viewing = useDetailViewing(
		data.detail.viewing,
		workKey(work.reference),
		() => refresh.mutate(),
	);
	const airing = useInfiniteQuery(
		airingQuery(work.reference.provider, work.reference.id),
	);
	const progress = viewing.snapshot?.entry?.progress ?? null;
	const nextEpisode = nextPlayableEpisode(data.episodes, progress);
	const checkingProgress =
		viewing.visible &&
		!viewing.unmapped &&
		progress === null &&
		viewing.snapshot?.fetchedAt === null;
	const hasUnwatchedEpisode =
		progress !== null &&
		data.episodes.some(
			(episode) => episodeViewing(episode, progress) === "unwatched",
		);
	const disabledReason =
		nextEpisode !== null
			? null
			: !viewing.visible || viewing.unmapped
				? t("anime.playNextTrackingUnavailable")
				: checkingProgress
					? t("anime.playNextChecking")
					: progress === null
						? t("anime.playNextTrackingUnavailable")
						: hasUnwatchedEpisode
							? t("anime.playNextNoLocal")
							: t("anime.playNextCaughtUp");
	function playNext() {
		if (!nextEpisode) return;
		const versions = nextEpisode.versions.filter(
			(version) => version.available,
		);
		const [version] = versions;
		if (version && versions.length === 1) {
			navigate(controller.playPath(version, nextEpisode));
			return;
		}
		controller.selectEpisode(nextEpisode.id);
	}
	useEffect(() => {
		const play = params.get("play");
		if (!play || handledPlay.current === play) return;
		handledPlay.current = play;
		const target =
			play === "next"
				? nextEpisode
				: (data.episodes.find((episode) => episode.id === play) ?? null);
		if (target) {
			const versions = target.versions.filter((version) => version.available);
			const [version] = versions;
			if (version && versions.length === 1) {
				navigate(controller.playPath(version, target), { replace: true });
				return;
			}
			controller.selectEpisode(target.id);
		} else {
			toast.add({
				id: `play-next:${work.id}`,
				type: "error",
				title: t("anime.playNextUnavailable"),
			});
		}
		const cleaned = new URLSearchParams(params);
		cleaned.delete("play");
		setParams(cleaned, { replace: true });
	}, [
		params,
		nextEpisode,
		data.episodes,
		navigate,
		controller,
		setParams,
		t,
		work.id,
	]);
	return (
		<section className="stack-page">
			<div className="action-row justify-between">
				<Link
					to={libraryPath}
					state={{ focusWork: work.id }}
					className={buttonStyles("outline")}
					preventScrollReset
				>
					<ArrowLeft size={16} aria-hidden="true" />
					{t("anime.back")}
				</Link>
				<Button
					variant="outline"
					disabled={refresh.isPending || metadata.refreshing}
					aria-busy={refresh.isPending || metadata.refreshing}
					onClick={() => refresh.mutate()}
				>
					<RefreshCw
						size={16}
						aria-hidden="true"
						className={
							refresh.isPending || metadata.refreshing
								? "animate-spin"
								: undefined
						}
					/>
					{t(
						refresh.isPending || metadata.refreshing
							? "anime.refreshing"
							: "anime.refresh",
					)}
				</Button>
			</div>

			<p className="text-sm text-muted-foreground">
				{t("anime.metadataUpdated", {
					time: new Date(metadata.fetchedAt).toLocaleString(i18n.language),
				})}
			</p>
			{metadata.stale && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("anime.stale")}
				</p>
			)}
			<Artwork
				key={`banner:${metadata.fetchedAt}`}
				url={data.bannerUrl}
				title={work.displayTitle}
				banner
			/>
			<WorkMetadataHeader
				action={
					<PlayNextButton
						episode={nextEpisode}
						disabledReason={disabledReason}
						onPlay={playNext}
					/>
				}
				data={data}
				viewing={
					<ViewingSummary
						state={viewing}
						episodeCount={metadata.data.episodeCount}
						airedEpisodeCount={airedEpisodeCount(metadata.data)}
					/>
				}
			/>
			<div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<EpisodeList
					trackingProgress={viewing.snapshot?.entry?.progress ?? null}
					data={data}
					controller={controller}
					renderResourceActions={renderResourceActions}
					airing={airing}
				/>
				<aside className="min-w-0 space-y-4">
					<AiringStatus query={airing} />
					<WorkSynopsis data={data} />
					<WorkMetadataExtras data={data} controller={controller} />
					<RelatedWorks controller={controller} />
				</aside>
			</div>
			{renderSubscription?.(workKey(work.reference), data.detail)}
			<VersionSelector
				controller={controller}
				renderResourceActions={renderResourceActions}
			/>
		</section>
	);
}
