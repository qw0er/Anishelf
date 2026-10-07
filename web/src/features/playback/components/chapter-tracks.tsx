import type { MediaTimeline } from "@anishelf/backend/contracts/media";
import { useQuery } from "@tanstack/react-query";
import { TextTrack, useMediaPlayer } from "@vidstack/react";
import { useEffect } from "react";
import { ApiClientError, getChapters } from "../../../api/client.js";
import { boundedSignal, keys, useQueryScope } from "../../../api/queries.js";
import { toast } from "../../../components/ui/toast.js";
import { chapterCues } from "../chapters.js";

export function ChapterTracks({
	fileId,
	sourceVersion,
	timeline,
}: {
	fileId: string;
	sourceVersion: string;
	timeline: MediaTimeline;
}) {
	const player = useMediaPlayer();
	const query = useQuery({
		queryKey: keys.chapters(useQueryScope(), fileId, sourceVersion),
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
			title: "Chapters could not be loaded. You can keep watching.",
			actionProps: {
				children: "Retry chapters",
				onClick: () => {
					void query.refetch();
				},
			},
		});
		return () => toast.close(notificationId);
	}, [query.error, query.refetch, notificationId]);
	useEffect(() => {
		if (!player || !query.data || query.data.sourceVersion !== sourceVersion)
			return;
		const cues = chapterCues(query.data.chapters, timeline);
		if (!cues.length) return;
		const track = new TextTrack({
			id: `chapters:${fileId}:${sourceVersion}`,
			kind: "chapters",
			label: "Chapters",
			type: "json",
			content: { cues },
			default: true,
		});
		player.textTracks.add(track);
		track.setMode("showing");
		return () => {
			player.textTracks.remove(track);
		};
	}, [player, query.data, fileId, sourceVersion, timeline]);
	return null;
}
