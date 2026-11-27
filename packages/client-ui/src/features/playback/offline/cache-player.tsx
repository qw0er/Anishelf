import {
	type OfflineCacheHost,
	type OfflineCachePlayback,
	offlineCachePath,
} from "@anishelf/contracts/offline-cache";
import type {
	ExternalSubtitleTrack,
	LibmediaPlayerHandle,
} from "libmedia-react-player";
import { ArrowLeft } from "lucide-react";
import {
	type CSSProperties,
	lazy,
	Suspense,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router";
import { Button, buttonStyles } from "../../../shared/components/ui/button.js";
import { InlineError } from "../../../shared/components/ui/inline-error.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { useSystemPlayback } from "../use-system-playback.js";
import { useOfflineCache } from "./state.js";

const LibmediaPlayer = lazy(async () => ({
	default: (await import("libmedia-react-player")).LibmediaPlayer,
}));

type Playback = OfflineCachePlayback & { tracks: ExternalSubtitleTrack[] };
type LoadState =
	| { status: "loading" }
	| { status: "unavailable" }
	| { status: "ready"; data: Playback };

async function loadTracks(item: OfflineCachePlayback, signal: AbortSignal) {
	return Promise.all(
		item.subtitles.map(
			async ({
				id,
				url,
				format,
				label,
				language,
			}): Promise<ExternalSubtitleTrack> => {
				const response = await fetch(url, { signal, credentials: "omit" });
				if (!response.ok) throw new Error("Cached subtitle is unavailable.");
				const content = await response.blob();
				const track = { id, label, content, ...(language ? { language } : {}) };
				return format === "ass" || format === "ssa"
					? { ...track, format, renderer: "styled" }
					: { ...track, format };
			},
		),
	);
}

function OfflineVideo({
	host,
	data,
	onRetry,
}: {
	host: OfflineCacheHost;
	data: Playback;
	onRetry(): void;
}) {
	const { t, i18n } = useTranslation();
	const player = useRef<LibmediaPlayerHandle>(null);
	const systemPlayback = useSystemPlayback(player, data.name);
	const position = useRef(data.positionMs);
	const lastWrite = useRef(0);
	const ready = useRef(false);
	const ended = useRef(false);
	const [error, setError] = useState(false);

	useEffect(() => {
		function persist() {
			if (!ready.current) return;
			const value = ended.current ? 0 : position.current;
			void host.savePosition(data.lease, value).catch(() => {
				console.warn("offline_cache.position_save_failed");
			});
		}
		window.addEventListener("pagehide", persist);
		return () => {
			window.removeEventListener("pagehide", persist);
			persist();
		};
	}, [data.lease, host]);

	function record(value: number, flush: boolean) {
		if (!ready.current || !Number.isFinite(value)) return;
		position.current = Math.max(0, Math.round(value));
		const now = Date.now();
		if (!flush && now - lastWrite.current < 2_000) return;
		lastWrite.current = now;
		void host.savePosition(data.lease, position.current).catch(() => {
			console.warn("offline_cache.position_save_failed");
		});
	}

	return (
		<div
			className="anishelf-player relative mx-auto w-full bg-black"
			style={{ "--player-aspect-ratio": 16 / 9 } as CSSProperties}
		>
			<LibmediaPlayer
				ref={player}
				src={data.url}
				sourceFormat={data.format === "m4v" ? "mp4" : data.format}
				mediaRequest={{ credentials: "omit" }}
				externalSubtitles={data.tracks}
				initialPositionMs={data.positionMs}
				locale={i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en"}
				labels={{ player: t("player.videoLabel", { name: data.name }) }}
				onReady={(event) => {
					ready.current = true;
					if (event.initialPositionResult?.restored !== false)
						systemPlayback.ready(event);
				}}
				onTimeUpdate={(event) => {
					if (!ended.current) record(event.positionMs, false);
					systemPlayback.positionChanged(event);
				}}
				onSeeked={(event) => {
					ended.current = false;
					record(event.positionMs, true);
					systemPlayback.positionChanged(event);
				}}
				onPlaybackStateChange={(event) => {
					const { status } = event;
					if (status === "playing") ended.current = false;
					if (status === "paused" && !ended.current)
						record(
							player.current?.getSnapshot().positionMs ?? position.current,
							true,
						);
					systemPlayback.playbackStateChanged(event);
				}}
				onEnded={() => {
					ended.current = true;
					record(0, true);
				}}
				onError={(failure) => {
					if (failure.fatal && failure.reason !== "aborted") {
						systemPlayback.close();
						console.warn("offline_cache.playback_failed", {
							reason: failure.reason,
						});
						setError(true);
					}
				}}
			/>
			{error && (
				<div className="absolute inset-0 z-10 grid place-content-center gap-3 bg-black/90 p-4 text-center text-white">
					<p role="alert">{t("offlineCache.playFailed")}</p>
					<Button variant="secondary" onClick={onRetry}>
						{t("actions.retry")}
					</Button>
				</div>
			)}
		</div>
	);
}

export function OfflineCachePlayer() {
	const { t } = useTranslation();
	const cache = useOfflineCache();
	const { id } = useParams();
	const { search } = useLocation();
	const host = cache?.host;
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<LoadState>({ status: "loading" });
	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt identifies an explicit playback retry
	useEffect(() => {
		if (!host || !id) return;
		const abort = new AbortController();
		let lease: string | undefined;
		void Promise.resolve()
			.then(async () => {
				if (abort.signal.aborted) return;
				const opened = await host.open(id);
				if (!opened) {
					if (!abort.signal.aborted) setState({ status: "unavailable" });
					return;
				}
				if (abort.signal.aborted) {
					await host.close(opened.lease);
					return;
				}
				lease = opened.lease;
				const tracks = await loadTracks(opened, abort.signal);
				if (!abort.signal.aborted)
					setState({ status: "ready", data: { ...opened, tracks } });
			})
			.catch(() => {
				if (!abort.signal.aborted) setState({ status: "unavailable" });
			});
		return () => {
			abort.abort();
			// Let the player save its latest position before invalidating its lease.
			const closing = lease;
			if (closing)
				queueMicrotask(() => void host.close(closing).catch(() => {}));
		};
	}, [host, id, attempt]);

	const retry = () => {
		setState({ status: "loading" });
		setAttempt((value) => value + 1);
	};

	return (
		<section className="space-y-3" aria-label={t("offlineCache.title")}>
			<header className="flex min-w-0 items-center gap-2">
				<Link
					className={buttonStyles("ghost", "size-11 shrink-0 p-0")}
					to={{ pathname: offlineCachePath, search }}
					aria-label={t("offlineCache.back")}
				>
					<ArrowLeft size={20} aria-hidden="true" />
				</Link>
				<h1 className="break-all text-lg font-semibold">
					{state.status === "ready" ? state.data.name : t("offlineCache.title")}
				</h1>
			</header>
			{state.status === "loading" && (
				<Skeleton className="aspect-video w-full" />
			)}
			{state.status === "unavailable" && (
				<div className="space-y-3">
					<InlineError>{t("offlineCache.playFailed")}</InlineError>
					<Button variant="outline" onClick={retry}>
						{t("actions.retry")}
					</Button>
				</div>
			)}
			{host && state.status === "ready" && (
				<Suspense fallback={<Skeleton className="aspect-video w-full" />}>
					<OfflineVideo
						key={state.data.lease}
						host={host}
						data={state.data}
						onRetry={retry}
					/>
				</Suspense>
			)}
		</section>
	);
}
