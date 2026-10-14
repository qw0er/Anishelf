import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CatalogListResponse } from "../../../../shared/api/contracts.js";
import { Artwork } from "../../shared/components/artwork.js";

export function CatalogResults({
	items,
	librarySearch,
}: {
	items: CatalogListResponse["items"];
	librarySearch: string;
}) {
	const { t } = useTranslation();
	return (
		<ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
			{items.map((work) => (
				<li key={work.id} className="min-w-0">
					<Link
						id={`work-${work.id}`}
						className="block overflow-hidden rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
						to={`/anime/${encodeURIComponent(work.id)}?${new URLSearchParams({ library: `/${librarySearch}` })}`}
						aria-label={work.displayTitle}
					>
						<Artwork
							key={work.updatedAt}
							url={work.coverUrl}
							title={work.displayTitle}
						/>
						<div className="space-y-1 p-3">
							<h2
								className="line-clamp-2 font-medium wrap-anywhere"
								title={work.displayTitle}
							>
								{work.displayTitle}
							</h2>
							<p className="text-xs text-muted-foreground">
								{work.format?.replaceAll("_", " ") ?? t("anime.unknownFormat")}{" "}
								· {work.year ?? t("anime.unknownYear")}
							</p>
							<p className="text-xs">
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
							{work.format !== "MOVIE" &&
								work.episodeCount !== null &&
								work.availableEpisodes > work.availableRegularEpisodes && (
									<p className="text-xs">
										{t("anime.additionalAvailable", {
											count:
												work.availableEpisodes - work.availableRegularEpisodes,
										})}
									</p>
								)}
							{work.metadataStale && (
								<p className="text-xs text-muted-foreground">
									{t("anime.cached")}
								</p>
							)}
							{work.availableEpisodes === 0 && (
								<p className="text-xs text-muted-foreground">
									{t("anime.unavailable")}
								</p>
							)}
						</div>
					</Link>
				</li>
			))}
		</ul>
	);
}
