import {
	type MediaTimeline,
	originalTimeline,
} from "@anishelf/backend/contracts/media";
import { useQueryClient } from "@tanstack/react-query";
import {
	isVideoProvider,
	MediaPlayer,
	MediaProvider,
	type MediaProviderAdapter,
	type Src,
	VideoProviderLoader,
} from "@vidstack/react";
import {
	DefaultVideoLayout,
	defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import { fileQuery, useQueryScope } from "../../../api/queries.js";
import { loadQuery } from "../../../api/query-client.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import type { SubtitlePolicy } from "../../../config/media-policy.js";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ApiClientError, isRequestCancelled } from "../../../api/client.js";
import type { FileResponse } from "../../../api/contracts.js";
import { toast } from "../../../components/ui/toast.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import { SubtitleTracks } from "../../subtitles/public.js";

import { ChapterTracks } from "./chapter-tracks.js";

// The API URL has no file extension; route all original files to native video.
class DirectVideoLoader extends VideoProviderLoader {
	canPlay(source: Src) {
		return typeof source.src === "string";
	}
}
const directVideoLoaders = [DirectVideoLoader];
const defaultTimeline = originalTimeline();

export default function VideoPlayer({
	file,
	playbackUrl,
	sourceVersion,
	timeline = defaultTimeline,
	onMedia,
	onPlaybackFailure,
	expectsVideo,
	subtitlePolicy,
}: Pick<FileResponse, "file"> & {
	subtitlePolicy: SubtitlePolicy;
	playbackUrl: string;
	sourceVersion?: string | undefined;
	timeline?: MediaTimeline;
	onMedia?(video: HTMLVideoElement | null, timeline: MediaTimeline): void;
	onPlaybackFailure?(): void;
	expectsVideo?: boolean;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const scope = useQueryScope();
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const errorRequest = useRef<AbortController | null>(null);
	const notificationId = `video-playback:${file.id}`;
	const notifiedError = useRef<string | null>(null);

	useLayoutEffect(() => {
		toast.close(notificationId);
		onMedia?.(videoRef.current, timeline);
		return () => {
			if (!notifiedError.current) toast.close(notificationId);
			errorRequest.current?.abort();
			// Capture progress before Vidstack unloads the provider's source.
			onMedia?.(null, timeline);
		};
	}, [onMedia, notificationId, timeline]);

	function providerChanged(provider: MediaProviderAdapter | null) {
		const video = isVideoProvider(provider) ? provider.video : null;
		video?.setAttribute(
			"aria-label",
			t("player.videoLabel", { name: file.name }),
		);
		videoRef.current = video;
		onMedia?.(video, timeline);
	}

	async function playbackFailed(missingPicture = false) {
		let message = t(
			missingPicture
				? "errors.mediaPictureUnavailable"
				: "errors.mediaPlayback",
		);
		errorRequest.current?.abort();
		const controller = new AbortController();
		errorRequest.current = controller;
		try {
			await loadQuery(
				{ ...fileQuery(file.id, scope), staleTime: 0 },
				controller.signal,
				client,
			);
		} catch (cause) {
			if (controller.signal.aborted || isRequestCancelled(cause)) return;
			if (cause instanceof ApiClientError)
				message = t(getErrorTranslationKey(cause) ?? "errors.requestFailed", {
					maximumMiB: subtitlePolicy.maximumBytes / (1024 * 1024),
				});
		}
		if (controller.signal.aborted || notifiedError.current === message) return;
		notifiedError.current = message;
		toast.close(notificationId);
		toast.add({
			id: notificationId,
			type: "error",
			priority: "high",
			title: message,
		});
		onPlaybackFailure?.();
	}

	return (
		<MediaPlayer
			className="anishelf-player aspect-video max-h-[75vh] w-full bg-black"
			title={file.name}
			src={playbackUrl}
			viewType="video"
			load={interactionPolicy.playerLoad}
			preload={interactionPolicy.playerPreload}
			playsInline
			storage={null}
			logLevel="silent"
			onProviderChange={(provider) => {
				if (!provider) providerChanged(null);
			}}
			onProviderSetup={providerChanged}
			onError={() => {
				void playbackFailed();
			}}
			onLoadedMetadata={() => {
				const video = videoRef.current;
				if (
					expectsVideo &&
					video &&
					video.videoWidth === 0 &&
					video.videoHeight === 0
				)
					void playbackFailed(true);
			}}
		>
			<MediaProvider loaders={directVideoLoaders} />
			{sourceVersion && (
				<ChapterTracks
					fileId={file.id}
					sourceVersion={sourceVersion}
					timeline={timeline}
				/>
			)}
			<SubtitleTracks fileId={file.id} policy={subtitlePolicy} />
			<DefaultVideoLayout
				icons={defaultLayoutIcons}
				seekStep={interactionPolicy.seekStepSeconds}
			/>
		</MediaPlayer>
	);
}
