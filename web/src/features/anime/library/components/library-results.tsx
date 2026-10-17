import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AnimeLibraryResponse } from "../../../../shared/api/contracts.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { Artwork } from "../../shared/components/artwork.js";
import { ViewingBadge } from "../../tracking/public.js";

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
				const localDescription =
					work.format === "MOVIE"
						? t(localCount ? "anime.movieAvailable" : "anime.unavailable")
						: total === null
							? t("anime.availableCount", { count: localCount })
							: t("anime.regularCount", { count: localCount, total });
				const descriptionId = `${descriptionPrefix}-${work.id}`;
				const viewingDescription = work.viewing
					? `${t("trackingList.provider")} · ${t(`trackingList.statuses.${work.viewing.status}`)} · ${work.episodeCount !== null && work.episodeCount > 0 ? t("trackingList.episodeProgress", { progress: work.viewing.progress, total: work.episodeCount }) : t("trackingList.progress", { count: work.viewing.progress })}.`
					: viewingKnown
						? t("trackingList.untracked")
						: "";
				const description = [
					viewingDescription,
					localDescription,
					work.viewing ? t("trackingList.cumulative") : "",
				]
					.filter(Boolean)
					.join(" ");
				return (
					<li key={work.id} className="min-w-0">
						<Tooltip content={description}>
							<Link
								id={`work-${work.id}`}
								className="group flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-[box-shadow,border-color] hover:border-foreground/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring motion-reduce:transition-none"
								to={`${work.localWorkId === null ? `/anime/tracked/${encodeURIComponent(work.reference.id)}` : `/anime/${encodeURIComponent(work.id)}`}?${new URLSearchParams({ library: `/${librarySearch}` })}`}
								aria-label={work.displayTitle}
								aria-describedby={descriptionId}
							>
								<Artwork
									key={work.updatedAt}
									url={work.coverUrl}
									title={work.displayTitle}
								/>
								<div className="flex flex-1 flex-col gap-1.5 p-3">
									<h2
										className="line-clamp-2 min-h-10 text-sm leading-5 font-medium wrap-anywhere"
										title={work.displayTitle}
									>
										{work.displayTitle}
									</h2>
									<p className="text-xs text-muted-foreground">
										{work.format?.replaceAll("_", " ") ??
											t("anime.unknownFormat")}{" "}
										· {work.year ?? t("anime.unknownYear")}
									</p>
									{work.viewing && (
										<ViewingBadge
											viewing={work.viewing}
											episodeCount={work.episodeCount}
										/>
									)}
									{typeof work.availableUnwatchedEpisodes === "number" &&
										work.availableUnwatchedEpisodes > 0 && (
											<p className="text-xs text-muted-foreground">
												{t("episodeViewing.availableUnwatched", {
													count: work.availableUnwatchedEpisodes,
												})}
											</p>
										)}
									{viewingKnown && !work.viewing && (
										<p className="text-xs text-muted-foreground">
											{t("trackingList.untracked")}
										</p>
									)}
									<p className="mt-auto min-h-4 text-xs leading-4 tabular-nums">
										<span aria-hidden="true">
											{total === null
												? t("anime.localCount", { count: localCount })
												: t("anime.localProgress", {
														count: localCount,
														total,
													})}
										</span>
										<span className="sr-only">{localDescription}</span>
									</p>
								</div>
							</Link>
						</Tooltip>
						<span id={descriptionId} className="sr-only">
							{description}
						</span>
					</li>
				);
			})}
		</ul>
	);
}
