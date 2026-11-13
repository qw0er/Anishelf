import type { MediaTimeline } from "@anishelf/contracts/media";
import type { MoviElement } from "movi-player/element";
import wasmUrl from "movi-player/movi.wasm?url";
import { type CSSProperties, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ActivePlayback } from "../../../../shared/api/contracts.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import type { PlaybackClock } from "../engine.js";
import { loadPlayer, MoviClock } from "../movi.js";
import { type PlaybackFailure, playbackFailure } from "../runtime.js";
import {
	attachStyledSubtitles,
	embeddedSubtitleReader,
} from "../styled-subtitles.js";
import { prepareExternalSubtitles } from "../subtitles.js";

export default function VideoPlayer({
	fileId,
	displayTitle,
	active,
	sourceVersion,
	playbackReady = true,
	onMedia,
	onPlaybackFailure,
	onPlaybackRecovered,
	onAudioChange,
	onRetry,
}: {
	fileId: string;
	displayTitle: string;
	active: ActivePlayback;
	sourceVersion: string;
	playbackReady?: boolean;
	onMedia?(clock: PlaybackClock | null, timeline: MediaTimeline): void;
	onPlaybackFailure?(failure: PlaybackFailure): void;
	onPlaybackRecovered?(): void;
	onAudioChange?(index: number): void;
	onRetry?(): void;
}) {
	const { t } = useTranslation();
	const container = useRef<HTMLDivElement>(null);
	const playerRef = useRef<MoviElement | null>(null);
	const syncAudioRef = useRef<
		((audio: ActivePlayback["audio"]) => void) | null
	>(null);
	const silentVolume = useRef<number | null>(null);
	const current = useRef({ active, playbackReady, displayTitle, t });
	current.current = { active, playbackReady, displayTitle, t };
	const callbacks = useRef({
		onMedia,
		onPlaybackFailure,
		onPlaybackRecovered,
		onAudioChange,
		onRetry,
	});
	callbacks.current = {
		onMedia,
		onPlaybackFailure,
		onPlaybackRecovered,
		onAudioChange,
		onRetry,
	};
	const bindingKey = `${active.asset.id}:${active.asset.revision}:${active.resource.url}`;
	useEffect(() => {
		const host = container.current;
		if (!host) return;
		const binding = current.current.active;
		if (
			`${binding.asset.id}:${binding.asset.revision}:${binding.resource.url}` !==
			bindingKey
		)
			return;
		const timeline = binding.resource.timeline;
		const readEmbedded = embeddedSubtitleReader({
			fileId,
			sourceVersion,
			assetId: binding.asset.id,
			assetRevision: binding.asset.revision,
		});
		const abort = new AbortController();
		let player: MoviElement | undefined;
		let clock: MoviClock | undefined;
		let detachStyled: (() => void) | undefined;
		let subtitleWarning = false;
		let subtitles:
			| Awaited<ReturnType<typeof prepareExternalSubtitles>>
			| undefined;
		let notified = false;
		let failed = false;
		let loadedTimer: ReturnType<typeof setTimeout> | undefined;
		const fail = (error?: unknown) => {
			if (abort.signal.aborted || notified) return;
			notified = true;
			failed = true;
			const failure = playbackFailure(error);
			toast.add({
				id: `video-playback:${fileId}`,
				type: "error",
				title: current.current.t(`player.failures.${failure.kind}`),
				actionProps: {
					children: current.current.t("actions.retry"),
					onClick: () => callbacks.current.onRetry?.(),
				},
			});
			console.warn("[playback] Movi Player failed.", {
				fileId,
				assetId: binding.asset.id,
			});
			callbacks.current.onPlaybackFailure?.(failure);
		};
		const syncAudio = (audio: ActivePlayback["audio"]) => {
			if (!player?.player) return;
			if (!audio) {
				if (current.current.active.asset.audioTracks.length) {
					silentVolume.current ??= player.volume;
					player.volume = 0;
				}
				return;
			}
			if (silentVolume.current !== null) {
				player.volume = silentVolume.current;
				silentVolume.current = null;
			}
			if (
				player.player.trackManager.getActiveAudioTrack()?.id !==
					audio.streamIndex &&
				!player.player.selectAudioTrack(audio.streamIndex)
			)
				fail();
		};
		syncAudioRef.current = syncAudio;
		const detachClock = () => {
			clearTimeout(loadedTimer);
			detachStyled?.();
			detachStyled = undefined;
			clock?.dispose();
			clock = undefined;
			callbacks.current.onMedia?.(null, timeline);
			if (player) player.inert = true;
		};
		const attachLoaded = () => {
			if (abort.signal.aborted || !player?.player) return;
			if (clock?.player === player.player) return;
			detachClock();
			notified = false;
			subtitles?.attach(player);
			syncAudio(current.current.active.audio);
			clock = new MoviClock(player, player.player);
			clock.addEventListener("error", fail);
			detachStyled = attachStyledSubtitles({
				player,
				sidecars: subtitles,
				timeline,
				readEmbedded,
				onFailure: () => {
					console.warn("[playback] Styled subtitle rendering failed.", {
						fileId,
						assetId: binding.asset.id,
					});
					if (subtitleWarning) return;
					subtitleWarning = true;
					toast.add({
						id: `styled-subtitles:${fileId}`,
						type: "warning",
						title: current.current.t("player.styledSubtitleFallback"),
					});
				},
			});
			callbacks.current.onMedia?.(clock, timeline);
			player.inert = !current.current.playbackReady;
			console.info("[playback] Movi Player loaded.", {
				fileId,
				assetId: binding.asset.id,
				chapterCount: player.player.getChapters().length,
				fullscreenOwner: "movi",
			});
		};
		const loaded = () => {
			const core = player?.player;
			clearTimeout(loadedTimer);
			// Movi starts its internal opening-frame seek AFTER loadeddata. Restore after
			// that startup work so it cannot overwrite the application's saved position.
			loadedTimer = setTimeout(() => {
				if (player?.player === core) attachLoaded();
			}, 0);
		};
		const stateChanged = () => {
			const core = player?.player;
			if (failed && core?.getState() === "playing") {
				failed = false;
				notified = false;
				toast.close(`video-playback:${fileId}`);
				callbacks.current.onPlaybackRecovered?.();
				console.info("[playback] Movi playback recovered.", {
					fileId,
					assetId: binding.asset.id,
				});
			}
			if (clock && clock.player !== core) detachClock();
			// Upstream software recovery can replace a core without another loadeddata.
			if (
				!clock &&
				core &&
				["ready", "paused", "playing"].includes(core.getState())
			)
				loaded();
		};
		const errorDisplay = (event: Event) => {
			const detail = (
				event as CustomEvent<{ title?: string; message?: string }>
			).detail;
			fail(new Error(`${detail?.title ?? ""} ${detail?.message ?? ""}`));
		};
		const audioChanged = () => {
			// Initial default-track events must not overwrite the requested source track.
			if (!clock || abort.signal.aborted) return;
			const index = player?.player?.trackManager.getActiveAudioTrack()?.id;
			const track = current.current.active.asset.audioTracks.find(
				(item) => item.stream.index === index,
			);
			if (
				track &&
				track.sourceStreamIndex !==
					current.current.active.audio?.sourceStreamIndex
			)
				callbacks.current.onAudioChange?.(track.sourceStreamIndex);
		};
		void (async () => {
			const module = await loadPlayer();
			if (abort.signal.aborted) return;
			subtitles = await prepareExternalSubtitles(
				fileId,
				sourceVersion,
				timeline,
				abort.signal,
			);
			if (abort.signal.aborted) {
				subtitles.dispose();
				return;
			}
			player = new module.MoviElement();
			// The pinned element otherwise injects a Google Fonts stylesheet on its
			// next animation frame. Keep player chrome self-contained with system fonts.
			const fontStyle = document.createElement("style");
			fontStyle.setAttribute("data-movi-font", "");
			player.shadowRoot?.append(fontStyle);
			playerRef.current = player;
			player.inert = true;
			for (const attribute of ["controls", "playsinline", "noerrorscreen"])
				player.setAttribute(attribute, "");
			player.setAttribute("persist", "none");
			player.setAttribute("wasmurl", wasmUrl);
			player.setAttribute("sw", "auto");
			player.setAttribute("title", current.current.displayTitle);
			player.setAttribute("crossorigin", "use-credentials");
			player.className = "h-full w-full";
			player.addEventListener("loadstart", detachClock);
			player.addEventListener("loadeddata", loaded);
			player.addEventListener("statechange", stateChanged);
			player.addEventListener("error", fail);
			player.addEventListener("errordisplay", errorDisplay);
			player.addEventListener("audiotrackchange", audioChanged);
			player.append(...subtitles.tracks);
			player.setAttribute(
				"src",
				new URL(binding.resource.url, location.origin).href,
			);
			host.append(player);
		})().catch(fail);
		return () => {
			abort.abort();
			detachClock();
			subtitles?.dispose();
			if (player) {
				player.removeEventListener("loadstart", detachClock);
				player.removeEventListener("loadeddata", loaded);
				player.removeEventListener("statechange", stateChanged);
				player.removeEventListener("error", fail);
				player.removeEventListener("errordisplay", errorDisplay);
				player.removeEventListener("audiotrackchange", audioChanged);
				player.src = null;
				player.remove();
			}
			playerRef.current = null;
			syncAudioRef.current = null;
			silentVolume.current = null;
		};
	}, [fileId, sourceVersion, bindingKey]);
	useEffect(() => {
		const player = playerRef.current;
		if (!player) return;
		player.inert = !playbackReady;
		player.setAttribute("title", displayTitle);
		syncAudioRef.current?.(active.audio);
	}, [active.audio, playbackReady, displayTitle]);
	const aspectRatio =
		active.asset.video?.width && active.asset.video.height
			? active.asset.video.width / active.asset.video.height
			: 16 / 9;
	return (
		<section
			className="anishelf-player relative mx-auto w-full bg-black"
			style={{ "--player-aspect-ratio": aspectRatio } as CSSProperties}
			aria-label={displayTitle}
		>
			<div ref={container} className="h-full w-full" />
		</section>
	);
}
