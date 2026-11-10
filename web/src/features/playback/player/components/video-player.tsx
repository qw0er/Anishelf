import type { MediaTimeline } from "@anishelf/backend/contracts/media";
import type AVPlayerUI from "@libmedia/avplayer-ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ActivePlayback } from "../../../../shared/api/contracts.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { discoverSubtitles } from "../../../media/public.js";
import { AVPlayerClock, decoderResource, loadPlayer } from "../avplayer.js";
import type { PlaybackClock } from "../engine.js";
import { registerEmbeddedFonts } from "../fonts.js";
import type { PlaybackFailure } from "../runtime.js";
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
}: {
	fileId: string;
	displayTitle: string;
	active: ActivePlayback;
	sourceVersion: string;
	onMedia?(clock: PlaybackClock | null, timeline: MediaTimeline): void;
	onEndedChange?(ended: boolean): void;
	onFullscreenChange?(fullscreen: boolean): void;
	onContinuationOverlay?(element: HTMLDivElement | null): void;
	onPlaybackFailure?(failure: PlaybackFailure): void;
	onAudioChange?(index: number): void;
}) {
	const { i18n, t } = useTranslation();
	const container = useRef<HTMLDivElement>(null);
	const current = useRef(active);
	current.current = active;
	const playerRef = useRef<AVPlayerUI | null>(null);
	const mutedVolume = useRef<number | null>(null);
	const callbacks = useRef({
		onMedia,
		onEndedChange,
		onFullscreenChange,
		onContinuationOverlay,
		onPlaybackFailure,
		onAudioChange,
	});
	callbacks.current = {
		onMedia,
		onEndedChange,
		onFullscreenChange,
		onContinuationOverlay,
		onPlaybackFailure,
		onAudioChange,
	};
	const bindingKey = `${active.asset.id}:${active.asset.revision}:${active.resource.url}`;

	useEffect(() => {
		const binding = current.current;
		if (
			`${binding.asset.id}:${binding.asset.revision}:${binding.resource.url}` !==
			bindingKey
		)
			return;
		const host = container.current;
		if (!host) return;
		host.inert = true;
		let cancelled = false;
		let player: AVPlayerUI | undefined;
		let clock: AVPlayerClock | undefined;
		let releaseFonts: (() => void) | undefined;
		const abort = new AbortController();
		const timeline = binding.resource.timeline;
		let notified = false;
		const fail = (error?: unknown) => {
			if (cancelled || notified) return;
			notified = true;
			const code =
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				typeof error.code === "number"
					? error.code
					: null;
			const failure: PlaybackFailure = {
				code,
				kind:
					code === 2
						? "network"
						: code === 3
							? "decode"
							: code === 4
								? "unsupported"
								: "unknown",
			};
			toast.add({
				id: `video-playback:${fileId}`,
				type: "error",
				title: t(`player.failures.${failure.kind}`),
			});
			console.warn("[playback] AVPlayer failed.", {
				fileId,
				assetId: binding.asset.id,
			});
			callbacks.current.onPlaybackFailure?.(failure);
		};
		const fullscreen = () =>
			callbacks.current.onFullscreenChange?.(
				Boolean(document.fullscreenElement),
			);
		document.addEventListener("fullscreenchange", fullscreen);
		callbacks.current.onContinuationOverlay?.(host);
		void (async () => {
			const Player = await loadPlayer();
			if (cancelled) return;
			try {
				localStorage.setItem(
					"libmedia_system_language",
					i18n.language.startsWith("zh") ? "chinese" : "english",
				);
			} catch {}
			player = new Player({
				container: host,
				fullscreenDom: host,
				ui: { hasFolder: false, hasHeader: false, hasFooter: true },
				getWasm: decoderResource,
				enableWebCodecs: true,
				enableHardware: true,
				// In 1.3.1, subtitle packets cannot cross the non-shared Worker heap.
				enableWorker: false,
				findBestStream: (streams, mediaType) => {
					const type = ["Video", "Audio", "Data", "Subtitle", "Attachment"][
						mediaType
					];
					const choices =
						player
							?.getStreams()
							.filter(
								(s) => s.mediaType === type && (s.disposition & 1024) === 0,
							) ?? [];
					const requested =
						mediaType === 1
							? current.current.audio?.streamIndex
							: mediaType === 0
								? current.current.asset.video?.index
								: undefined;
					const chosen =
						choices.find((s) => s.index === requested) ??
						choices.find((s) => (s.disposition & 1) !== 0) ??
						choices.find((s) => (s.disposition & 1024) === 0);
					// Upstream accepts an absent stream, although its callback type excludes undefined.
					return streams.find(
						(s) => s.id === chosen?.id,
					) as (typeof streams)[number];
				},
			});

			player.on("error", fail);
			player.on("ended", () => callbacks.current.onEndedChange?.(true));
			player.on("played", () => callbacks.current.onEndedChange?.(false));
			player.on("changed", () => {
				if (!player) return;
				const id = player.getSelectedAudioStreamId();
				const index = player.getStreams().find((s) => s.id === id)?.index;
				const track = current.current.asset.audioTracks.find(
					(t) => t.stream.index === index,
				);
				if (
					track &&
					track.sourceStreamIndex !== current.current.audio?.sourceStreamIndex
				)
					callbacks.current.onAudioChange?.(track.sourceStreamIndex);
			});
			const sidecars = await discoverSubtitles(fileId, {
				signal: abort.signal,
			}).catch(() => null);
			if (cancelled) return;
			const externalSubtitles =
				sidecars?.sourceVersion === sourceVersion
					? (
							await Promise.all(
								sidecars.tracks
									.filter(
										(track) => track.origin === "external" && track.format,
									)
									.map(async (track) => {
										try {
											const response = await fetch(
												`/api/files/${encodeURIComponent(fileId)}/subtitles/${encodeURIComponent(track.id)}/content?${new URLSearchParams({ sourceVersion, subtitleVersion: track.sourceVersion })}`,
												{ credentials: "same-origin", signal: abort.signal },
											);
											if (!response.ok)
												throw new Error("Subtitle unavailable.");
											return {
												// Upstream detects text formats from the filename; content URLs have no extension.
												source: new File(
													[await response.blob()],
													`subtitle.${track.format}`,
												),
												title: track.label ?? track.name,
												lang: track.language ?? "",
											};
										} catch {
											if (!cancelled)
												console.warn(
													"[playback] A sidecar subtitle could not be loaded.",
													{ fileId, trackId: track.id },
												);
											return null;
										}
									}),
							)
						).filter((track) => track !== null)
					: [];
			if (cancelled) return;
			await player.load(new URL(binding.resource.url, location.origin).href, {
				http: { credentials: "same-origin" },
				externalSubtitles,
			});
			if (cancelled) return;
			releaseFonts = await registerEmbeddedFonts(player);
			if (cancelled) {
				releaseFonts();
				return;
			}
			if (current.current.audio) {
				const stream = player
					.getStreams()
					.find((s) => s.index === current.current.audio?.streamIndex);
				if (stream) await player.selectAudio(stream.id);
			} else if (current.current.asset.audioTracks.length) {
				mutedVolume.current = player.getVolume();
				player.setVolume(0);
			}
			if (cancelled) return;
			playerRef.current = player;
			clock = new AVPlayerClock(player);
			clock.readyState = 1;
			clock.addEventListener("error", fail);
			callbacks.current.onMedia?.(clock, timeline);
			host.inert = false;
			console.info("[playback] AVPlayer loaded.", {
				fileId,
				assetId: binding.asset.id,
				language: i18n.language,
			});
		})().catch(fail);
		return () => {
			cancelled = true;
			abort.abort();
			document.removeEventListener("fullscreenchange", fullscreen);
			callbacks.current.onMedia?.(null, timeline);
			callbacks.current.onContinuationOverlay?.(null);
			playerRef.current = null;
			mutedVolume.current = null;
			clock?.dispose();
			releaseFonts?.();
			void player?.destroy().catch(() => {});
		};
		// The engine binds bytes once. Track changes are applied below without replacing the clock/session.
	}, [fileId, sourceVersion, i18n.language, bindingKey, t]);

	useEffect(() => {
		const player = playerRef.current;
		if (!player) return;
		const audio = active.audio;
		if (!audio) {
			mutedVolume.current ??= player.getVolume();
			player.setVolume(0);
			return;
		}
		if (mutedVolume.current !== null) {
			player.setVolume(mutedVolume.current);
			mutedVolume.current = null;
		}
		const stream = player
			.getStreams()
			.find((s) => s.index === audio.streamIndex);
		if (stream && stream.id !== player.getSelectedAudioStreamId())
			void player.selectAudio(stream.id).catch(() =>
				callbacks.current.onPlaybackFailure?.({
					kind: "unknown",
					code: null,
				}),
			);
	}, [active.audio]);

	const aspectRatio =
		active.asset.video?.width && active.asset.video.height
			? active.asset.video.width / active.asset.video.height
			: 16 / 9;
	return (
		<section
			className="anishelf-player relative mx-auto w-full bg-black"
			style={{
				aspectRatio,
				maxWidth: `${75 * aspectRatio}vh`,
				maxHeight: "75vh",
			}}
			aria-label={displayTitle}
		>
			<div className="h-full w-full" ref={container} />
		</section>
	);
}
