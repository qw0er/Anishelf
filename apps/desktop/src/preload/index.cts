import type { DesktopBridge } from "../ipc/desktop.js";

const { contextBridge, ipcRenderer } =
	require("electron") as typeof import("electron");

const desktop: DesktopBridge = {
	getServerOrigin: () => ipcRenderer.invoke("desktop:server-origin"),
	signIn: (password) => ipcRenderer.invoke("desktop:sign-in", password),
	clearDeviceToken: () => ipcRenderer.invoke("desktop:clear-device-token"),
	copyText: (text) => ipcRenderer.invoke("desktop:copy-text", text),
	openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
	openPlayer: (url) => ipcRenderer.invoke("desktop:open-player", url),
	downloadFile: (url, filename) =>
		ipcRenderer.invoke("desktop:download-file", url, filename),
};

contextBridge.exposeInMainWorld("desktop", desktop);
