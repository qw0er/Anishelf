import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
	AnimeLibraryResponse,
	CatalogListResponse,
} from "../../../../shared/api/contracts.js";
import { Artwork } from "../../shared/components/artwork.js";
import { ViewingBadge } from "../../tracking/public.js";

export function CatalogResults({
	items,
	librarySearch,
	viewingKnown = false,
}: {
	items: (
		| AnimeLibraryResponse["items"][number]
		| CatalogListResponse["items"][number]
	)[];
	librarySearch: string;
	viewingKnown?: boolean;
}) {
	const { t } = useTranslation();
	return (
		<ul className="poster-grid">
			{items.map((work) => (
				<li key={work.id} className="min-w-0">
					<Link
						id={`work-${work.id}`}
						className="group flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-[box-shadow,border-color] hover:border-foreground/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring motion-reduce:transition-none"
						to={`${"localWorkId" in work && work.localWorkId === null ? `/anime/tracked/${encodeURIComponent(work.reference.id)}` : `/anime/${encodeURIComponent(work.id)}`}?${new URLSearchParams({ library: `/${librarySearch}` })}`}
						aria-label={work.displayTitle}
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
								{work.format?.replaceAll("_", " ") ?? t("anime.unknownFormat")}{" "}
								· {work.year ?? t("anime.unknownYear")}
							</p>
							{"viewing" in work && work.viewing && (
								<ViewingBadge viewing={work.viewing} />
							)}
							{viewingKnown && "viewing" in work && !work.viewing && (
								<p className="text-xs text-muted-foreground">
									{t("trackingList.untracked")}
								</p>
							)}
							{"localWorkId" in work && work.localWorkId === null && (
								<p className="text-xs text-muted-foreground">
									{t("trackingList.noLocal")}
								</p>
							)}
							<p className="mt-auto line-clamp-2 min-h-8 text-xs leading-4">
								{work.format === "MOVIE"
									? t(
											work.availableEpisodes > 0
												? "anime.movieAvailable"
												: "anime.unavailable",
										)
									: work.episodeCount === null
										? t("anime.availableCount", {
												count: work.availableEpisodes,
											})
										: t("anime.regularCount", {
												count: work.availableRegularEpisodes,
												total: work.episodeCount,
											})}
							</p>
						</div>
					</Link>
				</li>
			))}
		</ul>
	);
}
