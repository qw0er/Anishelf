import { basename } from "node:path";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import type { DownloadItem, Event, WebContents } from "electron";
import { httpUrl } from "./links.js";

export function downloadMedia(
	sender: WebContents,
	origin: string,
	value: unknown,
	filename: unknown,
) {
	if (typeof filename !== "string") throw new Error("Invalid download name.");
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

	return new Promise<void>((resolve, reject) => {
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
			item.once("done", (_event, state) => {
				if (state === "interrupted")
					console.warn("desktop.download_interrupted");
			});
			console.info("desktop.download_started");
			resolve();
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
