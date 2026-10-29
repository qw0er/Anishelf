import { workKey } from "@anishelf/backend/contracts/references";
import { Play } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AnimeLibraryResponse } from "../../../../shared/api/contracts.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { animePlayerPath } from "../../../../shared/navigation.js";
import { Artwork } from "../../shared/components/artwork.js";
import {
	sentenceViewingProgress,
	ViewingBadge,
} from "../../tracking/public.js";

export function LibraryResults({
	items,
	librarySearch,
	viewingKnown = false,
}: {
	items: AnimeLibraryResponse["items"];
	librarySearch: string;
	viewingKnown?: boolean;
}) {
	const { t } = useTranslation();
	const descriptionPrefix = useId();
	return (
		<ul className="poster-grid">
			{items.map((work) => {
				const total =
					work.format === "MOVIE"
						? 1
						: work.episodeCount !== null && work.episodeCount > 0
							? work.episodeCount
							: null;
				const localCount =
					work.format === "MOVIE"
						? Number(work.availableEpisodes > 0)
						: total === null
							? work.availableEpisodes
							: work.availableRegularEpisodes;
				const aired = work.format === "MOVIE" ? null : work.airedEpisodeCount;
				const airedDenominator =
					aired !== null && total !== null && aired > 0 && aired < total;
				const localDescription =
					work.format === "MOVIE"
						? t(localCount ? "anime.movieAvailable" : "anime.unavailable")
						: total === null
							? t("anime.availableCount", { count: localCount })
							: airedDenominator
								? t("anime.regularCountWithAired", {
										count: localCount,
										aired,
										total,
									})
								: t("anime.regularCount", { count: localCount, total });
				const descriptionId = `${descriptionPrefix}-${work.id}`;
				const viewingDescription = work.viewing
					? `${t("trackingList.provider")} · ${t(`trackingList.statuses.${work.viewing.status}`)} · ${sentenceViewingProgress({ progress: work.viewing.progress, aired, total: work.episodeCount }, t)}.`
					: work.viewingAvailability === "unmapped"
						? t("trackingList.unmapped")
						: viewingKnown && work.viewingAvailability === "untracked"
							? t("trackingList.untracked")
							: "";
				const description = [
					viewingDescription,
					localDescription,
					work.viewing ? t("trackingList.cumulative") : "",
				]
					.filter(Boolean)
					.join(" ");
				const next = work.nextPlayback ?? null;
				const directPlayback =
					next !== null &&
					next.versionCount === 1 &&
					next.fileId !== null &&
					next.sourceVersion !== null
						? { fileId: next.fileId, sourceVersion: next.sourceVersion }
						: null;
				const detailParams = new URLSearchParams({
					library: `/${librarySearch}`,
				});
				const detailHref = `${
					work.localWorkId === null
						? `/anime/tracked/${encodeURIComponent(workKey(work.reference))}`
						: `/anime/${encodeURIComponent(work.id)}`
				}?${detailParams}`;
				const playHref =
					next === null
						? null
						: directPlayback
							? animePlayerPath(
									directPlayback.fileId,
									work.id,
									next.episodeId,
									`/${librarySearch}`,
									directPlayback.sourceVersion,
								)
							: `${detailHref}&play=next`;
				const playLabel =
					next === null
						? null
						: work.format === "MOVIE"
							? t("anime.playMovie")
							: t("anime.playEpisode", { episode: next.episodeNumber });
				return (
					<li key={work.id} className="relative min-w-0">
						<Tooltip content={description}>
							<Link
								id={`work-${work.id}`}
								className="poster-card group"
								to={detailHref}
								aria-label={work.displayTitle}
								aria-describedby={descriptionId}
							>
								<div className="poster-artwork">
									<Artwork
										key={work.updatedAt}
										url={work.coverUrl}
										title={work.displayTitle}
									/>
								</div>
								<div className="poster-caption">
									<h2
										className="line-clamp-2 min-h-10 text-sm leading-5 font-semibold wrap-anywhere"
										title={work.displayTitle}
									>
										{work.displayTitle}
									</h2>
									<p className="text-xs text-muted-foreground">
										{work.format?.replaceAll("_", " ") ??
											t("anime.unknownFormat")}{" "}
										· {work.year ?? t("anime.unknownYear")}
									</p>
									<p className="text-xs text-muted-foreground">
										{t(
											total === null
												? "anime.localAvailable"
												: "anime.localAvailableTotal",
											{ count: localCount, total },
										)}
									</p>
									{work.viewing && (
										<ViewingBadge
											viewing={work.viewing}
											episodeCount={work.episodeCount}
											airedEpisodeCount={aired}
										/>
									)}
									{work.viewingAvailability === "unmapped" && (
										<p className="text-xs text-muted-foreground">
											{t("trackingList.unmapped")}
										</p>
									)}
									{viewingKnown && work.viewingAvailability === "untracked" && (
										<p className="text-xs text-muted-foreground">
											{t("trackingList.untracked")}
										</p>
									)}
								</div>
							</Link>
						</Tooltip>
						{next !== null && playHref !== null && playLabel !== null && (
							<Tooltip content={playLabel}>
								<Link
									to={playHref}
									aria-label={`${playLabel}: ${work.displayTitle}`}
									className="absolute top-2 right-2 z-10 inline-flex size-10 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
								>
									<Play className="size-4 fill-current" aria-hidden="true" />
								</Link>
							</Tooltip>
						)}
						<span id={descriptionId} className="sr-only">
							{description}
						</span>
					</li>
				);
			})}
		</ul>
	);
}
