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
import { interactionPolicy } from "../../../config/interaction-policy.js";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	ApiClientError,
	getFile,
	isRequestCancelled,
} from "../../../api/client.js";
import type {
	ClientConfigResponse,
	FileResponse,
} from "../../../api/contracts.js";
import { toast } from "../../../components/ui/toast.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import { SubtitleTracks } from "../../subtitles/public.js";

// The API URL has no file extension; route all original files to native video.
class DirectVideoLoader extends VideoProviderLoader {
	canPlay(source: Src) {
		return typeof source.src === "string";
	}
}
const directVideoLoaders = [DirectVideoLoader];

export default function VideoPlayer({
	file,
	playbackUrl,
	onMedia,
	subtitlePolicy,
}: FileResponse & {
	subtitlePolicy: ClientConfigResponse["subtitles"];
	onMedia?(video: HTMLVideoElement | null): void;
}) {
	const { t } = useTranslation();
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const errorRequest = useRef<AbortController | null>(null);
	const notificationId = `video-playback:${file.id}`;
	const notifiedError = useRef<string | null>(null);

	useLayoutEffect(() => {
		toast.close(notificationId);
		onMedia?.(videoRef.current);
		return () => {
			toast.close(notificationId);
			errorRequest.current?.abort();
			// Capture progress before Vidstack unloads the provider's source.
			onMedia?.(null);
		};
	}, [onMedia, notificationId]);

	function providerChanged(provider: MediaProviderAdapter | null) {
		const video = isVideoProvider(provider) ? provider.video : null;
		video?.setAttribute(
			"aria-label",
			t("player.videoLabel", { name: file.name }),
		);
		videoRef.current = video;
		onMedia?.(video);
	}

	async function playbackFailed() {
		let message = t("errors.mediaPlayback");
		errorRequest.current?.abort();
		const controller = new AbortController();
		errorRequest.current = controller;
		try {
			await getFile(file.id, { signal: controller.signal });
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
			onError={playbackFailed}
		>
			<MediaProvider loaders={directVideoLoaders} />
			<SubtitleTracks fileId={file.id} policy={subtitlePolicy} />
			<DefaultVideoLayout
				icons={defaultLayoutIcons}
				seekStep={interactionPolicy.seekStepSeconds}
			/>
		</MediaPlayer>
	);
}
