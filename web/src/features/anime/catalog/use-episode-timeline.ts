import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	MetadataAiringResponse,
	MetadataDetailsResponse,
} from "../../../shared/api/contracts.js";
import type { Episode } from "./detail-format.js";
import { confirmedEpisodeCount, episodeTimeline } from "./episode-timeline.js";

export function useEpisodeTimeline(
	workId: string,
	metadata: MetadataDetailsResponse | null,
	episodes: readonly Episode[],
	pages: readonly MetadataAiringResponse[],
) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [now, setNow] = useState(Date.now);
	const confirmed = confirmedEpisodeCount(metadata, pages, now);
	const [previous, setPrevious] = useState({ workId, aired: confirmed });
	const freshEvidence =
		Boolean(metadata && !metadata.stale && !metadata.refreshError) ||
		pages.some(
			(page) => !page.stale && !page.refreshError && page.data.items.length > 0,
		);
	const aired =
		!freshEvidence && previous.workId === workId && previous.aired !== null
			? previous.aired
			: confirmed;
	useEffect(() => {
		setPrevious((previous) =>
			previous.workId === workId && previous.aired === aired
				? previous
				: { workId, aired },
		);
	}, [workId, aired]);
	const boundary = Math.min(
		...[
			metadata?.data.nextAiringEpisode?.airingAt,
			...pages.flatMap((page) => page.data.items.map((item) => item.airingAt)),
		]
			.filter((time): time is number => time != null && time * 1000 > now)
			.map((time) => time * 1000),
	);
	useEffect(() => {
		if (!Number.isFinite(boundary)) return;
		const timer = setTimeout(
			() => {
				setNow(Date.now());
				void client.invalidateQueries({ queryKey: ["anime-detail"] });
				void client.invalidateQueries({
					queryKey: ["metadata-airing", metadata?.data.reference.id],
				});
			},
			Math.min(Math.max(1, boundary - Date.now()), 2_147_483_647),
		);
		return () => clearTimeout(timer);
	}, [boundary, client, metadata?.data.reference.id]);
	return {
		aired,
		episodes: episodeTimeline({
			workId,
			format: metadata?.data.format ?? null,
			episodes,
			aired,
			episodeLabel: (number) => t("player.episodeTitle", { number }),
		}),
	};
}
