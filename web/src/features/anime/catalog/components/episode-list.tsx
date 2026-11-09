import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocalWorkDetailResponse } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { episodeViewingCounts } from "../../tracking/public.js";
import type {
	AnimeEpisodeActionSlot,
	AnimeResourceActionSlot,
} from "../resource-actions.js";
import type { LocalWorkDetailController } from "../use-local-work-detail.js";
import { EpisodeRows } from "./episode-rows.js";
import { UnresolvedResources } from "./unresolved-resources.js";
export function EpisodeList({
	data,
	controller,
	renderResourceActions,
	trackingProgress,
	workKey,
	renderEpisodeAction,
}: {
	data: LocalWorkDetailResponse;
	trackingProgress: number | null;
	renderResourceActions: AnimeResourceActionSlot;
	controller: Pick<LocalWorkDetailController, "playPath" | "selectEpisode">;
	workKey: string;
	renderEpisodeAction?: AnimeEpisodeActionSlot;
}) {
	const { t } = useTranslation();
	const { work, episodes } = data;
	const counts = episodeViewingCounts(episodes, trackingProgress);
	return (
		<section className="space-y-3">
			<div className="flex flex-wrap items-center gap-1">
				<h2 className="section-title-prominent">{t("anime.episodes")}</h2>
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
						size="icon"
						variant="ghost"
						className="text-muted-foreground"
						aria-label={t("anime.episodeNumberingInfo")}
					>
						<Info className="size-4" aria-hidden="true" />
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
							<Info className="size-4" aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
			</div>
			<UnresolvedResources key={work.id} workId={work.id} />
			<EpisodeRows
				episodes={episodes}
				workKey={workKey}
				trackingProgress={trackingProgress}
				controller={controller}
				renderResourceActions={renderResourceActions}
				{...(renderEpisodeAction ? { renderEpisodeAction } : {})}
			/>
		</section>
	);
}
