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
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiClientError, getFile, isRequestCancelled } from "../api/client.js";
import type { FileResponse } from "../api/contracts.js";
import { getErrorTranslationKey } from "../lib/error-translation.js";
import { ExternalSubtitleTracks } from "./external-subtitles.js";

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
}: FileResponse & { onMedia?(video: HTMLVideoElement | null): void }) {
	const { t } = useTranslation();
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const errorRequest = useRef<AbortController | null>(null);
	const [error, setError] = useState<string | null>(null);

	useLayoutEffect(() => {
		onMedia?.(videoRef.current);
		return () => {
			errorRequest.current?.abort();
			// Capture progress before Vidstack unloads the provider's source.
			onMedia?.(null);
		};
	}, [onMedia]);

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
		setError(t("errors.mediaPlayback"));
		errorRequest.current?.abort();
		const controller = new AbortController();
		errorRequest.current = controller;
		try {
			await getFile(file.id, { signal: controller.signal });
		} catch (cause) {
			if (controller.signal.aborted || isRequestCancelled(cause)) return;
			if (cause instanceof ApiClientError)
				setError(t(getErrorTranslationKey(cause) ?? "errors.requestFailed"));
		}
	}

	return (
		<>
			<MediaPlayer
				className="anishelf-player aspect-video max-h-[75vh] w-full bg-black"
				title={file.name}
				src={playbackUrl}
				viewType="video"
				load="eager"
				preload="metadata"
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
				<ExternalSubtitleTracks fileId={file.id} />
				<DefaultVideoLayout icons={defaultLayoutIcons} seekStep={5} />
			</MediaPlayer>
			{error && (
				<p className="text-base text-destructive" role="alert">
					{error}
				</p>
			)}
		</>
	);
}
