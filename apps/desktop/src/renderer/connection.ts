import { createServerConnection } from "@anishelf/client-core/connection";
import type { DesktopBridge } from "../ipc/desktop.js";

declare global {
	interface Window {
		desktop?: DesktopBridge;
	}
}

export async function createDesktopConnection(desktop: DesktopBridge) {
	const origin = await desktop.getServerOrigin();
	return createServerConnection({
		origin,
		fetch: (url, init) =>
			fetch(url, { ...init, credentials: "omit", redirect: "error" }),
	});
}
