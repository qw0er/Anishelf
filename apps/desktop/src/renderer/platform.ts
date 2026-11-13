import {
	browserPlatform,
	type ClientPlatform,
	resolveBrowserPlayerUrl,
} from "@anishelf/client-ui/browser-platform";
import type { DesktopBridge } from "../ipc/desktop.js";

export function createDesktopPlatform(desktop: DesktopBridge): ClientPlatform {
	return {
		...browserPlatform,
		get device() {
			return browserPlatform.device;
		},
		copyText: (text) => desktop.copyText(text),
		openExternal(url) {
			void desktop.openExternal(url).catch(() => {
				console.warn("platform.external_link_failed");
			});
		},
		openPlayer(request) {
			const url = resolveBrowserPlayerUrl(browserPlatform, request);
			void desktop.openPlayer(url).catch(() => {
				console.warn("platform.external_player_failed");
			});
		},
		downloadFile(url, filename) {
			void desktop.downloadFile(url, filename).catch(() => {
				console.warn("platform.download_failed");
			});
		},
	};
}
