import { basename } from "node:path";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import {
	type DownloadItem,
	type Event,
	shell,
	type WebContents,
} from "electron";
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

	return new Promise<boolean>((resolve, reject) => {
		function cleanup() {
			clearTimeout(timeout);
			session.off("will-download", configureDownload);
		}

		function configureDownload(
			_event: Event,
			item: DownloadItem,
			contents: WebContents,
		) {
			if (contents !== sender || item.getURLChain()[0] !== url.href) return;
			cleanup();
			if (name && name !== "." && name !== "..")
				item.setSaveDialogOptions({ defaultPath: name });
			console.info("desktop.download_started");
			if (!id) resolve(true);

			let lastPercent: number | null | undefined;
			function reportProgress() {
				if (!id || sender.isDestroyed() || !item.getSavePath()) return;
				const percent = item.getPercentComplete();
				const progress = percent < 0 ? null : Math.min(percent, 100);
				if (progress === lastPercent) return;
				lastPercent = progress;
				sender.send("desktop:download-progress", id, progress);
			}
			if (id) item.on("updated", reportProgress);
			item.once("done", (_event, state) => {
				if (id) item.off("updated", reportProgress);
				if (state === "interrupted") {
					console.warn("desktop.download_interrupted");
					reject(new Error("Media download was interrupted."));
					return;
				}
				console.info(`desktop.download_${state}`);
				if (state === "completed" && id) {
					const paths = completedDownloads.get(sender) ?? new Map();
					paths.set(id, item.getSavePath());
					completedDownloads.set(sender, paths);
					// Keep enough paths for recent notifications in long-lived windows.
					const oldest = paths.keys().next().value;
					if (paths.size > 100 && oldest) paths.delete(oldest);
				}
				resolve(state === "completed");
			});
		}

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Media download did not start."));
		}, 30_000);
		timeout.unref();
		session.on("will-download", configureDownload);
		try {
			sender.downloadURL(url.href);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}
