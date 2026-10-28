import type { MediaTimeline } from "@anishelf/backend/contracts/media";
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
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ActivePlayback } from "../../../../shared/api/contracts.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import type { PlaybackUiSlots } from "../../public.js";
import { playbackInteractionPolicy } from "../policy.js";
import {
	nativeAudioTracks,
	type PlaybackFailure,
	playbackFailure,
	selectNativeAudio,
} from "../runtime.js";
import { ChapterTracks } from "./chapter-tracks.js";

class DirectVideoLoader extends VideoProviderLoader {
	canPlay(source: Src) {
		return typeof source.src === "string";
	}
}
const directVideoLoaders = [DirectVideoLoader];
/** Consumes one concrete binding. Never re-queries the original file to explain a copy failure. */
export default function VideoPlayer({
	fileId,
	displayTitle,
	active,
	sourceVersion,
	onMedia,
	onPlaybackFailure,
	onAudioChange,
	renderSubtitles,
}: {
	fileId: string;
	displayTitle: string;
	active: ActivePlayback;
	sourceVersion: string;
	onMedia?(video: HTMLVideoElement | null, timeline: MediaTimeline): void;
	onPlaybackFailure?(failure: PlaybackFailure): void;
	onAudioChange?(sourceStreamIndex: number): void;
	renderSubtitles?: PlaybackUiSlots["renderSubtitles"] | undefined;
}) {
	const { t } = useTranslation();
	const timeline = active.resource.timeline;
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const detachAudio = useRef<(() => void) | null>(null);
	const notified = useRef<string | null>(null);
	const notificationId = `video-playback:${fileId}`;
	useLayoutEffect(() => {
		toast.close(notificationId);
		onMedia?.(videoRef.current, timeline);
		return () => {
			if (!notified.current) toast.close(notificationId);
			detachAudio.current?.();
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
		detachAudio.current?.();
		detachAudio.current = null;
		const video = isVideoProvider(provider) ? provider.video : null;
		video?.setAttribute(
			"aria-label",
			t("player.videoLabel", { name: displayTitle }),
		);
		videoRef.current = video;
		onMedia?.(video, timeline);
	}
	function failed(failure = playbackFailure(videoRef.current?.error ?? null)) {
		const signature = `${failure.kind}:${failure.code}`;
		if (notified.current === signature) return;
		notified.current = signature;
		console.warn("[playback] Media attempt failed.", {
			fileId,
			assetId: active.asset.id,
			kind: failure.kind,
			code: failure.code,
		});
		toast.close(notificationId);
		toast.add({
			id: notificationId,
			type: "error",
			priority: "high",
			title: t(`player.failures.${failure.kind}`),
		});
		onPlaybackFailure?.(failure);
	}
	function metadataLoaded() {
		const video = videoRef.current;
		if (!video) return;
		if (
			active.asset.video &&
			video.videoWidth === 0 &&
			video.videoHeight === 0
		) {
			failed({ kind: "decode", code: 3 });
			return;
		}
		const audio = active.audio;
		if (audio && active.asset.audioTracks.length > 1) {
			if (
				!selectNativeAudio(video, audio.position) &&
				audio.streamIndex !== active.asset.defaultAudioStreamIndex
			) {
				failed({ kind: "unsupported", code: 4 });
				return;
			}
			const tracks = nativeAudioTracks(video);
			if (tracks) {
				const changed = () => {
					const index = Array.from(
						{ length: tracks.length },
						(_, position) => position,
					).find((position) => tracks[position]?.enabled);
					const source =
						index === undefined
							? undefined
							: active.asset.audioTracks[index]?.sourceStreamIndex;
					if (source !== undefined && source !== audio.sourceStreamIndex)
						onAudioChange?.(source);
				};
				tracks.addEventListener("change", changed);
				detachAudio.current = () =>
					tracks.removeEventListener("change", changed);
			}
		}
	}
	return (
		<MediaPlayer
			className="anishelf-player aspect-video max-h-[75vh] w-full bg-black"
			title={displayTitle}
			src={active.resource.url}
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
			onError={() => failed()}
			onLoadedMetadata={metadataLoaded}
		>
			<MediaProvider loaders={directVideoLoaders} />
			<ChapterTracks
				fileId={fileId}
				sourceVersion={sourceVersion}
				timeline={timeline}
			/>
			{renderSubtitles?.(fileId)}
			<DefaultVideoLayout
				icons={defaultLayoutIcons}
				seekStep={playbackInteractionPolicy.seekStepSeconds}
			/>
		</MediaPlayer>
	);
}
