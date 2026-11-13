import type { DesktopBridge } from "../ipc/desktop.js";

const { contextBridge, ipcRenderer } =
	require("electron") as typeof import("electron");

const desktop: DesktopBridge = {
	getServerOrigin: () => ipcRenderer.invoke("desktop:server-origin"),
	signIn: (password) => ipcRenderer.invoke("desktop:sign-in", password),
	clearDeviceToken: () => ipcRenderer.invoke("desktop:clear-device-token"),
};

contextBridge.exposeInMainWorld("desktop", desktop);
