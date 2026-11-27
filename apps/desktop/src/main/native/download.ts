import { basename } from "node:path";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import { shell, type WebContents } from "electron";
import { downloadPercent, transferDownload } from "./download-transfer.js";
import { httpUrl } from "./links.js";

const completedDownloads = new WeakMap<WebContents, Map<string, string>>();

export async function revealDownload(sender: WebContents, id: unknown) {
	const path =
		typeof id === "string" ? completedDownloads.get(sender)?.get(id) : null;
	if (!path) throw new Error("Completed download is unavailable.");
	shell.showItemInFolder(path);
}

export function downloadMedia(
	sender: WebContents,
	origin: string,
	value: unknown,
	filename: unknown,
	id: unknown,
	onProgress?: (percent: number | null | undefined) => void,
) {
	if (typeof filename !== "string") throw new Error("Invalid download name.");
	if (
		id !== undefined &&
		(typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
	)
		throw new Error("Invalid download ID.");
	const playlist =
		typeof value === "string" && value.startsWith(`blob:${desktopOrigin}/`);
	const url = playlist ? new URL(value) : httpUrl(value);
	const validSource = playlist
		? filename.endsWith(".m3u")
		: url.origin === origin &&
			/^\/api\/media\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
			Boolean(url.searchParams.get("access_token"));
	if (!validSource) throw new Error("Invalid media download.");

	const name = basename(filename.replaceAll("\\", "/")).replace(
		/[\p{Cc}\p{Cf}]/gu,
		"",
	);
	const { session } = sender;
	let lastPercent: number | null | undefined;
	return new Promise<boolean>((resolve, reject) => {
		void transferDownload({
			session,
			url: url.href,
			begin: () => sender.downloadURL(url.href),
			matches: (contents) => contents === sender,
			configure(item) {
				if (name && name !== "." && name !== "..")
					item.setSaveDialogOptions({ defaultPath: name });
			},
			attached() {
				console.info("desktop.download_started");
				if (!id) resolve(true);
			},
			progress(item) {
				if (!id || !item.getSavePath()) return;
				const percent = downloadPercent(item);
				if (percent === lastPercent) return;
				lastPercent = percent;
				onProgress?.(percent);
				if (!sender.isDestroyed())
					sender.send("desktop:download-progress", id, percent);
			},
		}).then(
			(path) => {
				if (id) onProgress?.(undefined);
				console.info(
					path === null
						? "desktop.download_cancelled"
						: "desktop.download_completed",
				);
				if (path !== null && id) {
					const paths = completedDownloads.get(sender) ?? new Map();
					paths.set(id, path);
					completedDownloads.set(sender, paths);
					const oldest = paths.keys().next().value;
					if (paths.size > 100 && oldest) paths.delete(oldest);
				}
				resolve(path !== null);
			},
			(error: unknown) => {
				if (id) onProgress?.(undefined);
				console.warn("desktop.download_failed");
				reject(error);
			},
		);
	});
}
