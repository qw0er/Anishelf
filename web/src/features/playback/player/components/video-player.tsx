import {
	type MediaTimeline,
	sourceTimeMs,
} from "@anishelf/backend/contracts/media";
import {
	CaptionButton,
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
import { Loader2 } from "lucide-react";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { useLayoutEffect, useRef, useState } from "react";
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

type SourceSize = { width: number; height: number };

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
	onEndedChange,
	onFullscreenChange,
	onContinuationOverlay,
	onPlaybackFailure,
	onAudioChange,
	renderSubtitles,
}: {
	fileId: string;
	displayTitle: string;
	active: ActivePlayback;
	sourceVersion: string;
	onEndedChange?(ended: boolean): void;
	onFullscreenChange?(fullscreen: boolean): void;
	onContinuationOverlay?(element: HTMLDivElement | null): void;
	onMedia?(video: HTMLVideoElement | null, timeline: MediaTimeline): void;
	onPlaybackFailure?(failure: PlaybackFailure): void;
	onAudioChange?(sourceStreamIndex: number): void;
	renderSubtitles?: PlaybackUiSlots["renderSubtitles"] | undefined;
}) {
	const { t } = useTranslation();
	const [subtitlePreparation, setSubtitlePreparation] = useState<string | null>(
		null,
	);
	const timeline = active.resource.timeline;
	const played = useRef(false);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const detachAudio = useRef<(() => void) | null>(null);
	const notified = useRef<string | null>(null);
	const aspectReported = useRef(false);
	const [decodedSize, setDecodedSize] = useState<SourceSize | null>(null);
	const assetVideo = active.asset.video;
	const assetSize: SourceSize | null =
		assetVideo?.width && assetVideo.height
			? { width: assetVideo.width, height: assetVideo.height }
			: null;
	const sourceSize = decodedSize ?? assetSize;
	const sourceRatio = sourceSize
		? sourceSize.width / sourceSize.height
		: 16 / 9;
	const aspectRatio = sourceSize
		? `${sourceSize.width} / ${sourceSize.height}`
		: "16 / 9";
	const maxWidth = `min(100%, ${(75 * sourceRatio).toFixed(4)}vh)`;
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
		onEndedChange?.(false);
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
		if (video.videoWidth > 0 && video.videoHeight > 0) {
			setDecodedSize({ width: video.videoWidth, height: video.videoHeight });
			if (!aspectReported.current) {
				aspectReported.current = true;
				console.info("[playback] Source video dimensions resolved.", {
					fileId,
					width: video.videoWidth,
					height: video.videoHeight,
				});
			}
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
		<div className="mx-auto w-full" style={{ maxWidth }}>
			<MediaPlayer
				className="anishelf-player w-full bg-black"
				style={{ aspectRatio }}
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
				onFullscreenChange={onFullscreenChange}
				onPlaying={() => {
					played.current = true;
				}}
				onPlay={() => onEndedChange?.(false)}
				onSeeking={() => onEndedChange?.(false)}
				onEnded={() => {
					const video = videoRef.current;
					if (!video || video.error || !played.current) return;
					const complete =
						timeline.sourceDurationMs === null
							? timeline.sourceOriginMs === 0 && timeline.mediaOriginMs === 0
							: sourceTimeMs(video.currentTime * 1000, timeline) >=
								timeline.sourceDurationMs - 1000;
					onEndedChange?.(complete);
				}}
			>
				<MediaProvider loaders={directVideoLoaders} />
				<ChapterTracks
					fileId={fileId}
					sourceVersion={sourceVersion}
					timeline={timeline}
				/>
				{renderSubtitles?.(fileId, setSubtitlePreparation)}
				<DefaultVideoLayout
					icons={defaultLayoutIcons}
					slots={{
						captionButton: subtitlePreparation ? (
							<CaptionButton
								className="vds-caption-button vds-button"
								aria-busy="true"
								aria-label={subtitlePreparation}
							>
								<Loader2
									className="vds-icon motion-safe:animate-spin"
									aria-hidden="true"
								/>
							</CaptionButton>
						) : undefined,
					}}
					seekStep={playbackInteractionPolicy.seekStepSeconds}
				/>
				<div
					ref={onContinuationOverlay}
					className="absolute inset-x-4 top-4 z-30 rounded-lg border bg-background/95 p-3 text-foreground empty:hidden"
				/>
			</MediaPlayer>
		</div>
	);
}
