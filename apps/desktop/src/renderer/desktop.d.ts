import type { DesktopBridge } from "../ipc/desktop.js";

declare global {
	interface Window {
		desktop: DesktopBridge;
	}
}
