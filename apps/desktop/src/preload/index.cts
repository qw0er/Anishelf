import type { DesktopBridge } from "../ipc/desktop.js";

const { contextBridge, ipcRenderer } =
	require("electron") as typeof import("electron");

const desktop: DesktopBridge = {
	getServerOrigin: () => ipcRenderer.invoke("desktop:server-origin"),
	signIn: (origin, password) =>
		ipcRenderer.invoke("desktop:sign-in", origin, password),
	clearDeviceToken: (origin) =>
		ipcRenderer.invoke("desktop:clear-device-token", origin),
	copyText: (text) => ipcRenderer.invoke("desktop:copy-text", text),
	openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
	downloadFile: (url, filename) =>
		ipcRenderer.invoke("desktop:download-file", url, filename),
	listExternalPlayers: () =>
		ipcRenderer.invoke("desktop:external-players:list"),
	addExternalPlayer: (draft) =>
		ipcRenderer.invoke("desktop:external-players:add", draft),
	removeExternalPlayer: (id) =>
		ipcRenderer.invoke("desktop:external-players:remove", id),
	choosePlayerExecutable: () =>
		ipcRenderer.invoke("desktop:external-players:choose-executable"),
	launchExternalPlayer: (id, mediaUrl, mimeType) =>
		ipcRenderer.invoke(
			"desktop:external-players:launch",
			id,
			mediaUrl,
			mimeType,
		),
};

contextBridge.exposeInMainWorld("desktop", desktop);
