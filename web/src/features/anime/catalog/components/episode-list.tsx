import { useInfiniteQuery } from "@tanstack/react-query";
import { Info, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LocalWorkDetailResponse } from "../../../../shared/api/contracts.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { airingQuery } from "../../metadata/public.js";
import type { LocalWorkDetailController } from "../use-local-work-detail.js";
import { AiringStatus } from "./airing-status.js";
import { UnresolvedResources } from "./unresolved-resources.js";
export function EpisodeList({
	data,
	controller,
}: {
	data: LocalWorkDetailResponse;
	controller: Pick<LocalWorkDetailController, "playPath" | "selectEpisode">;
}) {
	const { t } = useTranslation();
	const { work, episodes } = data;
	const { playPath, selectEpisode } = controller;
	const airing = useInfiniteQuery(
		airingQuery(work.reference.provider, work.reference.id),
	);
	const schedules =
		airing.data?.pages
			.filter((page) => !page.stale && !page.refreshError)
			.flatMap((page) => page.data.items) ?? [];
	return (
		<section className="space-y-3">
			<div className="flex items-center gap-1">
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
											<Link
												className={buttonStyles()}
												to={playPath(usable[0], episode)}
												aria-label={`${t("anime.play")}: ${episode.label}`}
											>
												<Play size={16} aria-hidden="true" />
												{t("anime.play")}
											</Link>
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
			<AiringStatus query={airing} />
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
