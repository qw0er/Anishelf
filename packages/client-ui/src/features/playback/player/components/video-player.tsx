import type { MediaTimeline } from "@anishelf/contracts/media";
import type {
	ExternalSubtitleTrack,
	LibmediaPlayerError,
	LibmediaPlayerHandle,
} from "libmedia-react-player";
import {
	type CSSProperties,
	lazy,
	Suspense,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { getClientRuntime } from "../../../../shared/api/connection.js";
import type { ActivePlayback } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Skeleton } from "../../../../shared/components/ui/skeleton.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import {
	defaultLanguage,
	isSupportedLanguage,
} from "../../../../shared/config/languages.js";
import type { NextEpisodeAction } from "../../public.js";
import {
	readPlaybackPreferences,
	savePlaybackPreferences,
} from "../preferences.js";
import type { PlaybackFailure } from "../runtime.js";
import type { PlaybackBinding } from "../session.js";
import { prepareExternalSubtitles } from "../subtitles.js";

const LibmediaPlayer = lazy(async () => ({
	default: (await import("libmedia-react-player")).LibmediaPlayer,
}));
const webRequest = { credentials: "include" } as const;
const desktopRequest = { credentials: "omit" } as const;

interface VideoPlayerProps {
	fileId: string;
	displayTitle: string;
	active: ActivePlayback;
	sourceVersion: string;
	silent: boolean;
	bind(timeline: MediaTimeline, sourceVersion: string): PlaybackBinding | null;
	startContinuation(
		play: () => Promise<void>,
		signal: AbortSignal,
	): Promise<void>;
	nextEpisode?: NextEpisodeAction | undefined;
	onPlaybackFailure(failure: PlaybackFailure): void;
	onPlaybackRecovered(): void;
	onAudioChange(index: number | null): void;
	onReselect(): void;
}

export default function VideoPlayer(props: VideoPlayerProps) {
	const { connection } = getClientRuntime();
	const { t } = useTranslation();
	const { active, displayTitle, fileId, sourceVersion, onReselect } = props;
	const [timeline] = useState(active.resource.timeline);
	const src = connection.resolveResourceUrl(active.resource.url, true);
	const [subtitles, setSubtitles] =
		useState<readonly ExternalSubtitleTrack[]>();
	const [attempt, setAttempt] = useState(0);
	const [connected, setConnected] = useState(!connection.signal.aborted);
	const video = active.asset.video;
	const aspectRatio =
		video?.width && video.height ? video.width / video.height : 16 / 9;

	useEffect(() => {
		const abort = new AbortController();
		const signal = AbortSignal.any([connection.signal, abort.signal]);
		void prepareExternalSubtitles(fileId, sourceVersion, timeline, signal).then(
			(tracks) => {
				if (!signal.aborted) setSubtitles(tracks);
			},
		);
		const disconnect = () => setConnected(false);
		connection.signal.addEventListener("abort", disconnect, { once: true });
		if (connection.signal.aborted) disconnect();
		return () => {
			abort.abort();
			connection.signal.removeEventListener("abort", disconnect);
		};
	}, [connection, fileId, sourceVersion, timeline]);

	if (!connected) return null;
	return (
		<section aria-label={displayTitle}>
			<div
				className="anishelf-player relative mx-auto w-full bg-black"
				style={{ "--player-aspect-ratio": aspectRatio } as CSSProperties}
			>
				{!src ? (
					<div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center text-white">
						<p role="alert">{t("player.failures.unavailable")}</p>
						<Button variant="secondary" onClick={onReselect}>
							{t("actions.retry")}
						</Button>
					</div>
				) : subtitles ? (
					<Suspense fallback={<Skeleton className="size-full" />}>
						<VideoAttempt
							key={attempt}
							{...props}
							src={src}
							subtitles={subtitles}
							timeline={timeline}
							aspectRatio={aspectRatio}
							retry={() => setAttempt((previous) => previous + 1)}
						/>
					</Suspense>
				) : (
					<Skeleton className="size-full" />
				)}
			</div>
		</section>
	);
}

function VideoAttempt({
	active,
	aspectRatio,
	bind,
	displayTitle,
	fileId,
	nextEpisode,
	onAudioChange,
	onPlaybackFailure,
	onPlaybackRecovered,
	onReselect,
	retry,
	silent,
	sourceVersion,
	src,
	startContinuation,
	subtitles,
	timeline,
}: VideoPlayerProps & {
	aspectRatio: number;
	src: string;
	subtitles: readonly ExternalSubtitleTrack[];
	timeline: MediaTimeline;
	retry(): void;
}) {
	const { t, i18n } = useTranslation();
	const { authentication, onAuthRequired, platform } = getClientRuntime();
	const locale = isSupportedLanguage(i18n.resolvedLanguage)
		? i18n.resolvedLanguage
		: defaultLanguage;
	const player = useRef<LibmediaPlayerHandle>(null);
	const [binding, setBinding] = useState<PlaybackBinding | null>(null);
	const [ready, setReady] = useState(false);
	const [failure, setFailure] = useState<
		"restore" | PlaybackFailure["reason"]
	>();
	const failureReported = useRef(false);
	const readySession = useRef<string>(null);
	const failedRestore = useRef<string>(null);
	const [failedSession, setFailedSession] = useState<string>();
	const retrying = useRef(false);
	const requestedAudio =
		active.audio?.streamIndex ??
		(silent || active.asset.inspection === "complete" ? null : undefined);
	const asset = JSON.stringify([
		fileId,
		sourceVersion,
		active.asset.id,
		active.asset.revision,
	]);
	const [initialPreferences] = useState(() => ({
		...readPlaybackPreferences(platform.preferences, asset),
		...(requestedAudio === undefined
			? {}
			: {
					audio:
						requestedAudio === null
							? null
							: { streamIndex: requestedAudio, strict: true },
				}),
	}));
	const currentAudio = useRef(requestedAudio);
	const confirmedAudio = useRef(false);
	const container = active.asset.container;
	const format = container === "matroska" ? "mkv" : (container ?? undefined);

	useLayoutEffect(() => {
		const next = bind(timeline, sourceVersion);
		setBinding(next);
		return () => next?.dispose();
	}, [bind, sourceVersion, timeline]);

	useEffect(() => {
		const handle = player.current;
		if (!ready || !handle) return;
		const lifetime = new AbortController();
		void startContinuation(() => handle.play(), lifetime.signal);
		return () => lifetime.abort();
	}, [ready, startContinuation]);

	useEffect(() => {
		const handle = player.current;
		if (!ready || !handle || currentAudio.current === requestedAudio) return;
		currentAudio.current = requestedAudio;
		if (requestedAudio !== undefined)
			void handle.selectAudio(requestedAudio).catch(() => {});
	}, [ready, requestedAudio]);

	if (!binding) return <Skeleton className="size-full" />;

	const metadata = { fileId, assetId: active.asset.id };
	const failureLabel = failure ? t(`player.failures.${failure}`) : undefined;
	const reportFailure = (error: LibmediaPlayerError) => {
		if (!binding.accepts(error.sessionId) || error.reason === "aborted") return;
		const { reason, httpStatus, operation } = error;
		if (error.fatal) {
			if (failureReported.current) return;
			failureReported.current = true;
			console.warn("[playback] Media playback failed.", {
				...metadata,
				reason,
				httpStatus,
				operation,
			});
			setFailure(reason);
			setFailedSession(error.sessionId);
			onPlaybackFailure(
				httpStatus === undefined ? { reason } : { reason, httpStatus },
			);
			return;
		}
		if (
			operation === "track" ||
			(operation === "seek" && readySession.current === error.sessionId)
		) {
			console.warn("[playback] Playback operation failed.", {
				...metadata,
				reason,
				httpStatus,
				operation,
			});
			toast.add({
				id: `video-track:${fileId}`,
				type: "warning",
				title: t(
					operation === "seek"
						? "player.seekFailed"
						: error.message.includes("styled subtitles")
							? "player.styledSubtitleFallback"
							: "player.trackUnavailable",
				),
			});
		}
	};
	const retryPlayback = async () => {
		if (!failedSession || retrying.current) return;
		retrying.current = true;
		try {
			if (failure === "credentials") {
				const session = await authentication.getSession();
				if (!binding.accepts(failedSession)) return;
				if (!session.authenticated) {
					onAuthRequired();
					return;
				}
			} else if (
				failure === "not-found" ||
				failure === "forbidden" ||
				failure === "unavailable"
			) {
				onReselect();
				return;
			}
			console.info("[playback] Reloading media.", metadata);
			retry();
		} catch {
			if (binding.accepts(failedSession)) onAuthRequired();
		} finally {
			retrying.current = false;
		}
	};

	return (
		<>
			<div className="size-full" inert={failure !== undefined}>
				<LibmediaPlayer
					{...binding.events}
					ref={player}
					src={src}
					{...(format === undefined ? {} : { sourceFormat: format })}
					mediaRequest={
						platform.updates.kind === "desktop" ? desktopRequest : webRequest
					}
					initialPositionMs={binding.initialPositionMs}
					initialPlaybackPreferences={initialPreferences}
					locale={locale}
					externalSubtitles={subtitles}
					style={{ aspectRatio }}
					labels={{
						player: t("player.videoLabel", { name: displayTitle }),
						...(nextEpisode ? { nextEpisode: nextEpisode.label } : {}),
					}}
					{...(nextEpisode ? { onNextEpisode: nextEpisode.run } : {})}
					onReady={(event) => {
						if (!binding.accepts(event.sessionId)) return;
						if (event.initialPositionResult?.restored !== true) {
							failedRestore.current = event.sessionId;
							setFailure("restore");
							setFailedSession(event.sessionId);
							console.warn(
								"[playback] Could not restore media position.",
								metadata,
							);
							return;
						}

						readySession.current = event.sessionId;
						binding.events.onReady?.(event);
						setReady(true);
						onPlaybackRecovered();
						console.info("[playback] Media ready.", metadata);
					}}
					onError={reportFailure}
					onPlaybackPreferenceChange={({ sessionId, changes }) => {
						if (
							readySession.current !== sessionId ||
							!binding.accepts(sessionId) ||
							failureReported.current
						)
							return;
						savePlaybackPreferences(platform.preferences, asset, changes);
					}}
					onTrackChange={(event) => {
						if (
							!binding.accepts(event.sessionId) ||
							failedRestore.current === event.sessionId
						)
							return;
						if (!event.audio) {
							if (confirmedAudio.current && currentAudio.current !== null) {
								currentAudio.current = null;
								onAudioChange(null);
							}
							return;
						}
						const streamIndex = event.audio.streamIndex;
						const track = active.asset.audioTracks.find(
							(item) => item.stream.index === streamIndex,
						);
						if (!track) return;
						confirmedAudio.current = true;
						if (currentAudio.current === streamIndex) return;
						currentAudio.current = streamIndex;
						onAudioChange(track.sourceStreamIndex);
					}}
				/>
			</div>
			{failureLabel && (
				<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-white">
					<p role="alert">{failureLabel}</p>
					<Button variant="secondary" onClick={() => void retryPlayback()}>
						{t("actions.retry")}
					</Button>
				</div>
			)}
		</>
	);
}
