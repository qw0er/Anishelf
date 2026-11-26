import type { DesktopBridge, DesktopMenuCommand } from "../ipc/desktop.js";

const { contextBridge, ipcRenderer } =
	require("electron") as typeof import("electron");

const desktop: DesktopBridge = {
	offlineCache: {
		list: () => ipcRenderer.invoke("desktop:cache:list"),
		start: (target) => ipcRenderer.invoke("desktop:cache:start", target),
		cancel: (id) => ipcRenderer.invoke("desktop:cache:cancel", id),
		retry: (id) => ipcRenderer.invoke("desktop:cache:retry", id),
		remove: (id) => ipcRenderer.invoke("desktop:cache:remove", id),
		open: (id) => ipcRenderer.invoke("desktop:cache:open", id),
		savePosition: (lease, positionMs) =>
			ipcRenderer.invoke("desktop:cache:position", lease, positionMs),
		close: (lease) => ipcRenderer.invoke("desktop:cache:close", lease),
		subscribe(listener) {
			const receive: Parameters<typeof ipcRenderer.on>[1] = (
				_event,
				entry,
				id,
			) => listener(entry, id);
			ipcRenderer.on("desktop:cache:changed", receive);
			return () => {
				ipcRenderer.off("desktop:cache:changed", receive);
			};
		},
	},
	getLaunchAtLogin: () => ipcRenderer.invoke("desktop:login-item:get"),
	setLaunchAtLogin: (enabled) =>
		ipcRenderer.invoke("desktop:login-item:set", enabled),
	getCloseToTray: () => ipcRenderer.invoke("desktop:tray:get"),
	setCloseToTray: (enabled) => ipcRenderer.invoke("desktop:tray:set", enabled),
	setWindowControlsColors: (color, symbolColor) =>
		ipcRenderer.invoke(
			"desktop:window-controls:set-colors",
			color,
			symbolColor,
		),
	checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
	setLanguage: (language) =>
		ipcRenderer.invoke("desktop:language:set", language),
	consumePendingMenuCommand: () =>
		ipcRenderer.invoke("desktop:menu:consume-pending"),
	onMenuCommand(listener) {
		const receive = (
			_event: Electron.IpcRendererEvent,
			command: DesktopMenuCommand,
		) => listener(command);
		ipcRenderer.on("desktop:menu:command", receive);
		return () => {
			ipcRenderer.off("desktop:menu:command", receive);
		};
	},
	getServerConnection: () => ipcRenderer.invoke("desktop:server-connection"),
	useLocalBackend: () => ipcRenderer.invoke("desktop:use-local-backend"),
	signIn: (origin, password) =>
		ipcRenderer.invoke("desktop:sign-in", origin, password),
	clearDeviceToken: (origin) =>
		ipcRenderer.invoke("desktop:clear-device-token", origin),
	copyText: (text) => ipcRenderer.invoke("desktop:copy-text", text),
	chooseDirectory: () => ipcRenderer.invoke("desktop:choose-directory"),
	openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
	downloadFile: (url, filename, id) =>
		ipcRenderer.invoke("desktop:download-file", url, filename, id),
	onDownloadProgress(listener) {
		const receive = (
			_event: Electron.IpcRendererEvent,
			id: string,
			percent: number | null,
		) => listener(id, percent);
		ipcRenderer.on("desktop:download-progress", receive);
		return () => {
			ipcRenderer.off("desktop:download-progress", receive);
		};
	},
	revealDownload: (id) => ipcRenderer.invoke("desktop:reveal-download", id),
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
