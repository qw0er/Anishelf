import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { episodeViewing } from "../../tracking/public.js";
import type { Episode } from "../detail-format.js";
import type {
	AnimeEpisodeActionSlot,
	AnimeResourceActionSlot,
} from "../resource-actions.js";
import type { LocalWorkDetailController } from "../use-local-work-detail.js";
import { AssociationCorrectionMenuItem } from "./association-correction-menu-item.js";

export function EpisodeRows({
	episodes,
	workKey,
	trackingProgress,
	controller,
	renderResourceActions,
	renderEpisodeAction,
}: {
	episodes: readonly Episode[];
	workKey: string;
	trackingProgress: number | null;
	controller?: Pick<LocalWorkDetailController, "playPath" | "selectEpisode">;
	renderResourceActions?: AnimeResourceActionSlot;
	renderEpisodeAction?: AnimeEpisodeActionSlot;
}) {
	const { t } = useTranslation();
	return (
		<>
			{episodes.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("anime.noAiredEpisodes")}
				</p>
			)}
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
												{t(`anime.${episode.availability}`)} ·{" "}
												{t("anime.versionCount", {
													count: episode.versions.length,
												})}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-1">
											{usable.length === 0 &&
												episode.kind === "regular" &&
												/^[1-9][0-9]*$/.test(episode.number) &&
												renderEpisodeAction?.({
													workKey,
													episode: Number(episode.number),
												})}
											{usable.length === 1 && usable[0] && controller ? (
												<div className="flex shrink-0 items-center gap-1">
													{renderResourceActions?.(
														usable[0],
														<AssociationCorrectionMenuItem
															reviewId={usable[0].reviewId}
														/>,
													)}
													<Link
														className={buttonStyles()}
														to={controller.playPath(usable[0], episode)}
														aria-label={`${t("anime.play")}: ${episode.label}`}
													>
														<Play size={16} aria-hidden="true" />
														{t("anime.play")}
													</Link>
												</div>
											) : (
												<Button
													disabled={usable.length === 0 || !controller}
													onClick={() => controller?.selectEpisode(episode.id)}
													aria-label={`${t("anime.play")}: ${episode.label}`}
												>
													<Play size={16} aria-hidden="true" />
													{t("anime.play")}
												</Button>
											)}
										</div>
									</li>
								);
							})}
						</ul>
					</section>
				) : null;
			})}
		</>
	);
}
