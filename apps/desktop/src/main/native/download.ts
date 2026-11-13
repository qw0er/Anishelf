import { basename } from "node:path";
import type { DownloadItem, Event, WebContents } from "electron";
import { httpUrl } from "./links.js";

export function downloadMedia(
	sender: WebContents,
	origin: string,
	value: unknown,
	filename: unknown,
) {
	const url = httpUrl(value);
	if (
		url.origin !== origin ||
		!/^\/api\/media\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
		!url.searchParams.get("access_token") ||
		typeof filename !== "string"
	)
		throw new Error("Invalid media download.");

	const name = basename(filename.replaceAll("\\", "/")).replace(
		/[\p{Cc}\p{Cf}]/gu,
		"",
	);
	const { session } = sender;

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
			if (state === "interrupted") console.warn("desktop.download_interrupted");
		});
		console.info("desktop.download_started");
	}

	const timeout = setTimeout(cleanup, 30_000);
	timeout.unref();
	session.on("will-download", configureDownload);
	try {
		sender.downloadURL(url.href);
	} catch (error) {
		cleanup();
		throw error;
	}
}
