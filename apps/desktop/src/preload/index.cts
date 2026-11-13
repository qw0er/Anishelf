import type { DesktopBridge } from "../ipc/desktop.js";

const { contextBridge, ipcRenderer } =
	require("electron") as typeof import("electron");

function invoke<Method extends keyof DesktopBridge>(
	method: Method,
	...args: Parameters<DesktopBridge[Method]>
): ReturnType<DesktopBridge[Method]> {
	return ipcRenderer.invoke(`desktop:${method}`, ...args) as ReturnType<
		DesktopBridge[Method]
	>;
}

const desktop: DesktopBridge = {
	configuration: () => invoke("configuration"),
	setDeviceToken: (token) => invoke("setDeviceToken", token),
	copyText: (text) => invoke("copyText", text),
	openExternal: (url) => invoke("openExternal", url),
	openPlayer: (url) => invoke("openPlayer", url),
	downloadFile: (url, filename) => invoke("downloadFile", url, filename),
};
contextBridge.exposeInMainWorld("desktop", desktop);
