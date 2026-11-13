import { basename } from "node:path";
import type { WebContents } from "electron";
import { httpUrl } from "./links.js";

export function downloadMedia(
	sender: WebContents,
	origin: string,
	value: unknown,
	filename: unknown,
) {
	const session = sender.session;
	const url = httpUrl(value);
	if (
		url.origin !== origin ||
		!/^\/api\/media\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
		!url.searchParams.has("access_token") ||
		typeof filename !== "string"
	)
		throw new Error("Invalid download link.");
	const name = basename(filename.replaceAll("\\", "/")).replace(
		/[\p{Cc}]/gu,
		"",
	);
	function configureDownload(
		_event: Electron.Event,
		item: Electron.DownloadItem,
		webContents: WebContents,
	) {
		if (webContents !== sender || item.getURLChain()[0] !== url.href) return;
		clearTimeout(timeout);
		session.off("will-download", configureDownload);
		if (name && name !== "." && name !== "..")
			item.setSaveDialogOptions({ defaultPath: name });
		console.info("desktop.download_started", { server: origin });
	}
	session.on("will-download", configureDownload);
	const timeout = setTimeout(
		() => session.off("will-download", configureDownload),
		30_000,
	);
	timeout.unref();
	sender.downloadURL(url.href);
}
