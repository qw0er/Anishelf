import type { MediaTimeline } from "@anishelf/backend/contracts/media";
import { useQuery } from "@tanstack/react-query";
import { TextTrack, useMediaPlayer } from "@vidstack/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ApiClientError } from "../../../../shared/api/client.js";
import {
	boundedSignal,
	useQueryScope,
} from "../../../../shared/api/queries.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { getChapters } from "../api.js";
import { chapterCues } from "../chapters.js";
import { playbackKeys } from "../queries.js";

export function ChapterTracks({
	fileId,
	sourceVersion,
	timeline,
}: {
	fileId: string;
	sourceVersion: string;
	timeline: MediaTimeline;
}) {
	const { t } = useTranslation();
	const player = useMediaPlayer();
	const query = useQuery({
		queryKey: playbackKeys.chapters(useQueryScope(), fileId, sourceVersion),
		staleTime: Infinity,
		retry: (attempt, error) =>
			attempt < 2 && error instanceof ApiClientError && error.status === 503,
		queryFn: ({ signal }) =>
			getChapters(fileId, sourceVersion, { signal: boundedSignal(signal) }),
	});
	const notificationId = `chapters:${fileId}:${sourceVersion}`;
	useEffect(() => {
		if (!query.error) {
			toast.close(notificationId);
			return;
		}
		toast.add({
			id: notificationId,
			type: "error",
			title: t("player.chaptersLoadFailed"),
			actionProps: {
				children: t("player.retryChapters"),
				onClick: () => {
					void query.refetch();
				},
			},
		});
		return () => toast.close(notificationId);
	}, [query.error, query.refetch, notificationId, t]);
	useEffect(() => {
		if (!player || !query.data || query.data.sourceVersion !== sourceVersion)
			return;
		const cues = chapterCues(query.data.chapters, timeline);
		if (!cues.length) return;
		const track = new TextTrack({
			id: `chapters:${fileId}:${sourceVersion}`,
			kind: "chapters",
			label: t("player.chapters"),
			type: "json",
			content: { cues },
			default: true,
		});
		player.textTracks.add(track);
		track.setMode("showing");
		return () => {
			player.textTracks.remove(track);
		};
	}, [player, query.data, fileId, sourceVersion, timeline, t]);
	return null;
}
