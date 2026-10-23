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
import { useQueryScope } from "../../../../shared/api/queries.js";
import { loadQuery } from "../../../../shared/api/query-client.js";
import { fileQuery } from "../../../resources/public.js";
import type { PlaybackUiSlots } from "../../public.js";
import { playbackInteractionPolicy } from "../policy.js";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	ApiClientError,
	isRequestCancelled,
} from "../../../../shared/api/client.js";
import type { FileResponse } from "../../../../shared/api/contracts.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";

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
	displayTitle = file.name,
	playbackUrl,
	sourceVersion,
	timeline = defaultTimeline,
	onMedia,
	onPlaybackFailure,
	expectsVideo,
	renderSubtitles,
	subtitlePolicy,
}: Pick<FileResponse, "file"> & {
	displayTitle?: string;
	subtitlePolicy: { readonly maximumBytes: number };
	renderSubtitles?: PlaybackUiSlots["renderSubtitles"] | undefined;
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

	useLayoutEffect(() => {
		videoRef.current?.setAttribute(
			"aria-label",
			t("player.videoLabel", { name: displayTitle }),
		);
	}, [displayTitle, t]);

	function providerChanged(provider: MediaProviderAdapter | null) {
		const video = isVideoProvider(provider) ? provider.video : null;
		video?.setAttribute(
			"aria-label",
			t("player.videoLabel", { name: displayTitle }),
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
			title={displayTitle}
			src={playbackUrl}
			viewType="video"
			load={playbackInteractionPolicy.playerLoad}
			preload={playbackInteractionPolicy.playerPreload}
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
			{renderSubtitles?.(file.id)}
			<DefaultVideoLayout
				icons={defaultLayoutIcons}
				seekStep={playbackInteractionPolicy.seekStepSeconds}
			/>
		</MediaPlayer>
	);
}
