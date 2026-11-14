import {
	browserPlatform,
	type ClientPlatform,
} from "@anishelf/client-ui/browser-platform";
import type { DesktopBridge } from "../../ipc/desktop.js";
import { createDesktopExternalPlayers } from "./external-players.js";

export async function createDesktopPlatform(
	desktop: DesktopBridge,
): Promise<ClientPlatform> {
	const externalPlayers = await createDesktopExternalPlayers(desktop);
	return {
		...browserPlatform,
		updates: { kind: "desktop", check: desktop.checkForUpdates },
		get device() {
			return browserPlatform.device;
		},
		externalPlayers,
		copyText: (text) => desktop.copyText(text),
		openExternal(url) {
			void desktop.openExternal(url).catch(() => {
				console.warn("platform.external_link_failed");
			});
		},
		downloadFile(url, filename) {
			void desktop.downloadFile(url, filename).catch(() => {
				console.warn("platform.download_failed");
			});
		},
	};
}
