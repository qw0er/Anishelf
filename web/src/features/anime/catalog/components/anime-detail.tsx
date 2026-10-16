import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { CatalogDetailResponse } from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Skeleton } from "../../../../shared/components/ui/skeleton.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import { Artwork } from "../../shared/components/artwork.js";
import { useViewingState, ViewingSummary } from "../../tracking/public.js";
import { workQuery } from "../queries.js";

import { useWorkDetail } from "../use-work-detail.js";
import { EpisodeList } from "./episode-list.js";
import { RelatedWorks } from "./related-works.js";
import { VersionSelector } from "./version-selector.js";
import { WorkMetadataExtras } from "./work-metadata-extras.js";
import { WorkMetadataHeader } from "./work-metadata-header.js";
import { WorkSynopsis } from "./work-synopsis.js";
export function AnimeDetail() {
	const { id = "" } = useParams();
	const scope = useQueryScope();
	const query = useQuery(workQuery(id, scope));
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
	return <WorkDetail key={`${id}:${scope}`} data={query.data} />;
}
function WorkDetail({ data }: { data: CatalogDetailResponse }) {
	const { t, i18n } = useTranslation();
	const controller = useWorkDetail(data);
	const { libraryPath, refresh } = controller;
	const { work, metadata } = data;
	const viewing = useViewingState(
		work.reference.provider === "anilist" ? work.reference.id : undefined,
	);
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
				data={data}
				viewing={
					<ViewingSummary
						state={viewing}
						episodeCount={metadata.data.episodeCount}
					/>
				}
			/>
			<div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<EpisodeList data={data} controller={controller} />
				<aside className="min-w-0 space-y-4">
					<WorkSynopsis data={data} />
					<WorkMetadataExtras data={data} controller={controller} />
					<RelatedWorks controller={controller} />
				</aside>
			</div>
			<VersionSelector controller={controller} />
		</section>
	);
}
