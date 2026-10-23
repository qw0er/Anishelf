import type {
	InfiniteData,
	UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { Info, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
	LocalWorkDetailResponse,
	MetadataAiringResponse,
} from "../../../../shared/api/contracts.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { episodeViewing, episodeViewingCounts } from "../../tracking/public.js";
import type { AnimeResourceActionSlot } from "../resource-actions.js";
import type { LocalWorkDetailController } from "../use-local-work-detail.js";
import { UnresolvedResources } from "./unresolved-resources.js";
export function EpisodeList({
	data,
	controller,
	renderResourceActions,
	trackingProgress,
	airing,
}: {
	data: LocalWorkDetailResponse;
	trackingProgress: number | null;
	renderResourceActions: AnimeResourceActionSlot;
	controller: Pick<LocalWorkDetailController, "playPath" | "selectEpisode">;
	airing: UseInfiniteQueryResult<InfiniteData<MetadataAiringResponse>>;
}) {
	const { t } = useTranslation();
	const { work, episodes } = data;
	const { playPath, selectEpisode } = controller;
	const counts = episodeViewingCounts(episodes, trackingProgress);
	const schedules =
		airing.data?.pages
			.filter((page) => !page.stale && !page.refreshError)
			.flatMap((page) => page.data.items) ?? [];
	return (
		<section className="space-y-3">
			<div className="flex flex-wrap items-center gap-1">
				<h2 className="text-lg font-semibold">{t("anime.episodes")}</h2>
				<Tooltip
					openOnClick
					content={t(
						work.format === "MOVIE"
							? "anime.movieTimeline"
							: work.episodeCount === null
								? "anime.unknownTotal"
								: "anime.countDerived",
					)}
				>
					<Button
						variant="ghost"
						className="size-6 p-0 text-muted-foreground"
						aria-label={t("anime.episodeNumberingInfo")}
					>
						<Info className="size-3.5" aria-hidden="true" />
					</Button>
				</Tooltip>
				{trackingProgress !== null && counts.availableUnwatched > 0 && (
					<Tooltip content={t("episodeViewing.availabilityInfo")} openOnClick>
						<Button
							variant="ghost"
							className="ml-auto h-auto gap-1 px-1 py-0.5 text-xs text-muted-foreground"
							aria-label={t("episodeViewing.availabilityInfoLabel")}
						>
							{t("episodeViewing.availableUnwatched", {
								count: counts.availableUnwatched,
							})}
							<Info className="size-3.5" aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
			</div>
			{episodes.length === 0 && <p>{t("anime.noEpisodes")}</p>}
			{(["regular", "special", "movie"] as const).map((kind) => {
				const group = episodes.filter((episode) => episode.kind === kind);
				return group.length ? (
					<section key={kind} className="space-y-2">
						<h3 className="font-medium">{t(`anime.${kind}`)}</h3>
						<ul className="divide-y rounded-lg border px-4">
							{group.map((episode) => {
								const usable = episode.versions.filter(
									(version) => version.available,
								);
								const schedule =
									episode.kind === "regular" &&
									episode.provenance === "count-derived"
										? schedules.find(
												(item) => String(item.episode) === episode.number,
											)
										: undefined;
								const availability =
									episode.availability === "missing" &&
									schedule &&
									schedule.airingAt * 1000 > Date.now()
										? "notYetAired"
										: episode.availability;
								return (
									<li
										id={`episode-${episode.id}`}
										key={episode.id}
										className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
									>
										<div className="min-w-0 flex-1">
											<h4 className="font-medium wrap-anywhere">
												{episode.label}
											</h4>
											{trackingProgress !== null && (
												<p className="text-xs text-muted-foreground">
													{episodeViewing(episode, trackingProgress) ===
													"watched"
														? t("episodeViewing.watched")
														: episodeViewing(episode, trackingProgress) ===
																"unwatched"
															? t("episodeViewing.unwatched")
															: t("episodeViewing.unknown")}
												</p>
											)}
											<p className="text-sm text-muted-foreground">
												{t(`anime.${availability}`)} ·{" "}
												{t("anime.versionCount", {
													count: episode.versions.length,
												})}
												{episode.availability === "missing" &&
													!schedule &&
													` · ${t("anime.airingUnknown")}`}
											</p>
										</div>
										{usable.length === 1 && usable[0] ? (
											<div className="flex shrink-0 items-center gap-1">
												{renderResourceActions(usable[0])}
												<Link
													className={buttonStyles()}
													to={playPath(usable[0], episode)}
													aria-label={`${t("anime.play")}: ${episode.label}`}
												>
													<Play size={16} aria-hidden="true" />
													{t("anime.play")}
												</Link>
											</div>
										) : (
											<Button
												disabled={usable.length === 0}
												onClick={() => selectEpisode(episode.id)}
												aria-label={`${t("anime.play")}: ${episode.label}`}
											>
												<Play size={16} aria-hidden="true" />
												{t("anime.play")}
											</Button>
										)}
									</li>
								);
							})}
						</ul>
					</section>
				) : null;
			})}
			<UnresolvedResources workId={work.id} />
			<p className="text-sm text-muted-foreground">
				<Link to="/review?decision=confirmed" className="underline">
					{t("review.correct")}
				</Link>{" "}
				· {t("anime.unresolvedHint")}{" "}
				<Link to="/directories/root" className="underline">
					{t("app.files")}
				</Link>
			</p>
		</section>
	);
}
