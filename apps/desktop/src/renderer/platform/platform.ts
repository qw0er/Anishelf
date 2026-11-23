import {
	browserPlatform,
	type ClientPlatform,
} from "@anishelf/client-ui/browser-platform";
import type { DesktopBridge } from "../../ipc/desktop.js";
import { createDesktopExternalPlayers } from "./external-players.js";
import { createVideoDownloads } from "./video-downloads.js";

export async function createDesktopPlatform(
	desktop: DesktopBridge,
	options: { canChooseDirectories?: boolean; cacheServer?: string } = {},
): Promise<ClientPlatform> {
	const externalPlayers = await createDesktopExternalPlayers(desktop);
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
