import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LocalWorkDetailResponse } from "../../../../shared/api/contracts.js";
import { Artwork } from "../../shared/components/artwork.js";
import { airedEpisodeCount, fuzzyDate, safeLink } from "../detail-format.js";
export function WorkMetadataHeader({
	data,
	viewing,
	action,
}: {
	viewing?: ReactNode;
	action?: ReactNode;
	data: {
		metadata: LocalWorkDetailResponse["metadata"];
		work: Pick<
			LocalWorkDetailResponse["work"],
			| "displayTitle"
			| "coverUrl"
			| "format"
			| "year"
			| "episodeCount"
			| "reference"
		>;
	};
}) {
	const { t } = useTranslation();
	const { work, metadata } = data;
	const info = metadata.data;
	const providerUrl = safeLink(info.siteUrl);
	const aired = airedEpisodeCount(info);
	const airedValue =
		aired === null
			? null
			: info.episodeCount === null
				? String(aired)
				: `${aired} / ${info.episodeCount}`;
	return (
		<div className="grid min-w-0 gap-6 sm:grid-cols-[10rem_minmax(0,1fr)]">
			<div className="w-32 overflow-hidden rounded-lg sm:w-full">
				<Artwork
					key={`cover:${metadata.fetchedAt}`}
					url={work.coverUrl}
					title={work.displayTitle}
				/>
			</div>
			<div className="min-w-0 space-y-3">
				<h1 className="page-title">{work.displayTitle}</h1>
				<p className="text-sm text-muted-foreground wrap-anywhere">
					{[...new Set([...info.titles.map((title) => title.value)])]
						.filter((title) => title !== work.displayTitle)
						.join(" · ")}
				</p>
				{viewing}
				{action && (
					<div className="flex flex-wrap items-center gap-2">{action}</div>
				)}
				<dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
					{[
						["format", work.format?.replaceAll("_", " ")],
						["year", work.year],
						["releaseStatus", info.status?.replaceAll("_", " ")],
						["episodeCount", work.episodeCount],
						...(airedValue === null
							? []
							: ([["airedEpisodes", airedValue]] as const)),
						["startDate", fuzzyDate(info.startDate)],
						["endDate", fuzzyDate(info.endDate)],
					].map(([key, value]) => (
						<div key={key}>
							<dt className="text-muted-foreground">{t(`anime.${key}`)}</dt>
							<dd>{value ?? t("anime.unknown")}</dd>
						</div>
					))}
				</dl>
				<p className="text-sm">
					{t("anime.provider", { provider: work.reference.provider })}
					{providerUrl && (
						<>
							{" "}
							·{" "}
							<a
								className="underline"
								href={providerUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								{t("anime.providerPage")}
							</a>
						</>
					)}
				</p>
			</div>
		</div>
	);
}
