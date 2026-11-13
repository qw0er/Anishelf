import type { DesktopBridge } from "../ipc/desktop.js";

const { contextBridge, ipcRenderer } =
	require("electron") as typeof import("electron");

const desktop: DesktopBridge = {
	getServerOrigin: () => ipcRenderer.invoke("desktop:server-origin"),
};

contextBridge.exposeInMainWorld("desktop", desktop);
