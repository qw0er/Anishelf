import {
	browserPlatform,
	type ClientPlatform,
} from "@anishelf/client-ui/browser-platform";
import type { DesktopBridge } from "../../ipc/desktop.js";
import { createDesktopExternalPlayers } from "./external-players.js";
import { createSystemMediaHost } from "./system-media.js";
import { createVideoDownloads } from "./video-downloads.js";

export async function createDesktopPlatform(
	desktop: DesktopBridge,
	options: {
		canChooseDirectories?: boolean;
		cacheServer?: string;
		fetchResource(path: string, init: RequestInit): Promise<Response>;
	},
): Promise<ClientPlatform> {
	const externalPlayers = await createDesktopExternalPlayers(desktop);
	const media = navigator.mediaSession;
	const displayRequests = new Set<symbol>();
	function setVideoPlaying(playing: boolean) {
		void desktop.setVideoPlaying(playing).catch((error: unknown) => {
			console.warn("desktop.playback_power_update_failed", { playing, error });
		});
	}
	function requestDownload(url: string, filename: string) {
		return desktop.downloadFile(url, filename).catch(() => {
			console.warn("platform.download_failed");
		});
	}
	return {
		...browserPlatform,
		updates: { kind: "desktop", check: desktop.checkForUpdates },
		get device() {
			return browserPlatform.device;
		},
		externalPlayers,
		...(media && {
			systemMedia: createSystemMediaHost(media, options.fetchResource),
		}),
		keepDisplayAwake() {
			const request = Symbol();
			displayRequests.add(request);
			if (displayRequests.size === 1) setVideoPlaying(true);
			return () => {
				if (displayRequests.delete(request) && displayRequests.size === 0)
					setVideoPlaying(false);
			};
		},
		offlineCache: {
			host: desktop.offlineCache,
			server: options.cacheServer ?? "local",
		},
		videoDownloads: createVideoDownloads(desktop),
		copyText: (text) => desktop.copyText(text),
		...(options.canChooseDirectories
			? { chooseDirectory: () => desktop.chooseDirectory() }
			: {}),
		openExternal(url) {
			void desktop.openExternal(url).catch(() => {
				console.warn("platform.external_link_failed");
			});
		},
		downloadFile(url, filename) {
			void requestDownload(url, filename);
		},
		downloadText(content, filename, mediaType) {
			const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
			// Keep the blob available until Electron attaches it to the download item.
			void requestDownload(url, filename).finally(() =>
				URL.revokeObjectURL(url),
			);
		},
	};
}
