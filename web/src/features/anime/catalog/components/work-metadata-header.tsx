import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LocalWorkDetailResponse } from "../../../../shared/api/contracts.js";
import { Artwork } from "../../shared/components/artwork.js";
import { airedEpisodeCount, fuzzyDate } from "../detail-format.js";
export function WorkMetadataHeader({
	data,
	viewing,
	action,
	subscription,
	bannerUrl,
	airedCount,
}: {
	bannerUrl?: string | null;
	airedCount?: number | null;
	viewing?: ReactNode;
	action?: ReactNode;
	subscription?: ReactNode;
	data: {
		metadata: LocalWorkDetailResponse["metadata"];
		work: Pick<
			LocalWorkDetailResponse["work"],
			"displayTitle" | "coverUrl" | "format" | "year" | "episodeCount"
		>;
	};
}) {
	const { t } = useTranslation();
	const { work, metadata } = data;
	const info = metadata.data;
	const aired =
		airedCount === undefined
			? airedEpisodeCount(info, metadata.fetchedAt)
			: airedCount;
	const startDate = fuzzyDate(info.startDate);
	const endDate = fuzzyDate(info.endDate);
	const airedValue =
		aired === null
			? null
			: info.episodeCount === null
				? String(aired)
				: `${aired} / ${info.episodeCount}`;

	return (
		<div className="work-hero">
			{bannerUrl && (
				<div className="work-hero-banner" aria-hidden="true">
					<Artwork url={bannerUrl} title="" banner />
				</div>
			)}
			<div className="work-hero-content">
				<div className="work-hero-cover">
					<Artwork
						key={`cover:${metadata.fetchedAt}`}
						url={work.coverUrl}
						title={work.displayTitle}
					/>
				</div>
				<div className="min-w-0 max-w-3xl space-y-4">
					<h1 className="text-2xl leading-tight font-semibold tracking-tight wrap-anywhere sm:text-3xl xl:text-4xl">
						{work.displayTitle}
					</h1>
					<p className="text-xs text-muted-foreground">
						{t("metadataSource.source")}:{" "}
						{t(`metadataSource.names.${info.provider}`, {
							defaultValue: info.provider,
						})}
					</p>
					<dl className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
						{[
							["format", work.format?.replaceAll("_", " ")],
							["year", work.year],
							[
								"releaseStatus",
								info.status
									? t(`anime.releaseStatuses.${info.status}`, {
											defaultValue: info.status.replaceAll("_", " "),
										})
									: null,
							],
						].map(([key, value]) => (
							<div key={key} className="text-muted-foreground">
								<dt className="sr-only">{t(`anime.${key}`)}</dt>
								<dd className="font-medium">{value ?? t("anime.unknown")}</dd>
							</div>
						))}
					</dl>
					<dl className="flex max-w-3xl flex-wrap gap-x-6 gap-y-2 text-sm">
						{[
							["totalEpisodes", work.episodeCount ?? t("anime.unknown")],
							...(airedValue === null ? [] : [["airedEpisodes", airedValue]]),
							...(startDate ? [["startDate", startDate]] : []),
							...(endDate ? [["endDate", endDate]] : []),
						].map(([key, value]) => (
							<div key={key} className="flex items-baseline gap-2">
								<dt className="text-muted-foreground">{t(`anime.${key}`)}</dt>
								<dd className="font-medium tabular-nums">{value}</dd>
							</div>
						))}
					</dl>
					{(viewing || action) && (
						<div className="work-primary-actions">
							{action && (
								<div className="work-play-action flex flex-wrap items-center gap-2">
									{action}
								</div>
							)}
							{viewing}
						</div>
					)}
					{subscription}
				</div>
			</div>
		</div>
	);
}
