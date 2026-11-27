import type {
	SystemMediaAction,
	SystemMediaHost,
	SystemMediaMetadata,
	SystemMediaSession,
} from "@anishelf/client-ui/browser-platform";
import appIcon from "../../../assets/app-icon.png?inline";

// Chromium accepts data URLs for media artwork served from the desktop renderer.
const defaultArtwork = { src: appIcon, type: "image/png", sizes: "1024x1024" };
const seekActions = ["seekto", "seekbackward", "seekforward"] as const;
const defaultSeekSeconds = 10;
const commands = {
	play: () => ({ kind: "play" }),
	pause: () => ({ kind: "pause" }),
	seekto: ({ seekTime }) =>
		seekTime === undefined
			? undefined
			: { kind: "seekTo", positionMs: seekTime * 1000 },
	seekbackward: ({ seekOffset = defaultSeekSeconds }) => ({
		kind: "seekBy",
		offsetMs: -seekOffset * 1000,
	}),
	seekforward: ({ seekOffset = defaultSeekSeconds }) => ({
		kind: "seekBy",
		offsetMs: seekOffset * 1000,
	}),
} satisfies Partial<
	Record<
		MediaSessionAction,
		(details: MediaSessionActionDetails) => SystemMediaAction | undefined
	>
>;

type FetchResource = (path: string, init: RequestInit) => Promise<Response>;

async function loadArtwork(
	fetchResource: FetchResource,
	url: string,
	signal: AbortSignal,
) {
	const response = await fetchResource(url, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
	});
	if (
		!response.ok ||
		!response.headers.get("content-type")?.startsWith("image/")
	) {
		await response.body?.cancel();
		throw new Error("Media artwork is unavailable.");
	}
	const blob = await response.blob();
	const image = await createImageBitmap(blob);
	const sizes = `${image.width}x${image.height}`;
	image.close();
	return { blob, sizes };
}

export function createSystemMediaHost(
	media: MediaSession,
	fetchResource: FetchResource,
): SystemMediaHost {
	let active: SystemMediaSession | undefined;
	return {
		open(initialMetadata, handleAction) {
			active?.close();
			let canSeek = false;
			let metadata: SystemMediaMetadata | undefined;
			let artwork = defaultArtwork;
			let artworkRequest: AbortController | undefined;
			function resetArtwork() {
				artworkRequest?.abort();
				artworkRequest = undefined;
				if (artwork !== defaultArtwork) URL.revokeObjectURL(artwork.src);
				artwork = defaultArtwork;
			}
			function publishMetadata() {
				if (metadata)
					media.metadata = new MediaMetadata({
						title: metadata.title,
						artwork: [artwork],
					});
			}
			function setAction(action: keyof typeof commands, enabled: boolean) {
				const dispatch: MediaSessionActionHandler = (details) => {
					if (active !== session) return;
					const command = commands[action](details);
					if (!command) return;
					void handleAction(command).catch((error: unknown) => {
						console.warn("desktop.system_media_action_failed", {
							action,
							errorType: error instanceof Error ? error.name : "unknown",
						});
					});
				};
				try {
					media.setActionHandler(action, enabled ? dispatch : null);
				} catch (error) {
					console.debug("desktop.system_media_action_unavailable", {
						action,
						errorType: error instanceof Error ? error.name : "unknown",
					});
				}
			}
			const session: SystemMediaSession = {
				setMetadata(next) {
					if (active !== session) return;
					const artworkChanged = metadata?.artworkUrl !== next.artworkUrl;
					if (!artworkChanged && metadata?.title === next.title) return;
					metadata = next;
					if (artworkChanged) resetArtwork();
					publishMetadata();
					if (!artworkChanged || !next.artworkUrl) return;
					const request = new AbortController();
					artworkRequest = request;
					void loadArtwork(fetchResource, next.artworkUrl, request.signal)
						.then(({ blob, sizes }) => {
							if (request.signal.aborted) return;
							artwork = {
								src: URL.createObjectURL(blob),
								type: blob.type,
								sizes,
							};
							publishMetadata();
							console.debug("desktop.system_media_artwork_loaded");
						})
						.catch((error: unknown) => {
							if (!request.signal.aborted)
								console.debug("desktop.system_media_artwork_failed", {
									errorType: error instanceof Error ? error.name : "unknown",
								});
						});
				},
				update({ status, durationMs, positionMs, playbackRate }) {
					if (active !== session) return;
					if (media.playbackState !== status) media.playbackState = status;
					const hasDuration =
						durationMs !== null &&
						Number.isFinite(durationMs) &&
						durationMs > 0;
					if (canSeek !== hasDuration) {
						canSeek = hasDuration;
						for (const action of seekActions) setAction(action, canSeek);
						if (!canSeek) media.setPositionState();
					}
					if (
						!hasDuration ||
						!Number.isFinite(positionMs) ||
						!Number.isFinite(playbackRate) ||
						playbackRate <= 0
					)
						return;
					media.setPositionState({
						duration: durationMs / 1000,
						position: Math.max(0, Math.min(positionMs, durationMs)) / 1000,
						playbackRate,
					});
				},
				close() {
					if (active !== session) return;
					active = undefined;
					setAction("play", false);
					setAction("pause", false);
					if (canSeek)
						for (const action of seekActions) setAction(action, false);
					media.metadata = null;
					resetArtwork();
					media.playbackState = "none";
					media.setPositionState();
					console.debug("desktop.system_media_closed");
				},
			};
			active = session;
			session.setMetadata(initialMetadata);
			setAction("play", true);
			setAction("pause", true);
			console.debug("desktop.system_media_opened");
			return session;
		},
	};
}
