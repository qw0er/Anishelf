import type { DownloadItem, Event, Session, WebContents } from "electron";

interface DownloadTransfer {
	session: Session;
	url: string;
	begin(): void;
	matches(contents: WebContents): boolean;
	configure(item: DownloadItem): void;
	signal?: AbortSignal;
	attached?(): void;
	progress?(item: DownloadItem): void;
}

export function transferDownload({
	session,
	url,
	begin,
	matches,
	configure,
	signal,
	attached,
	progress,
}: DownloadTransfer) {
	signal?.throwIfAborted();
	return new Promise<string | null>((resolve, reject) => {
		function cleanup() {
			clearTimeout(timeout);
			session.off("will-download", onDownload);
		}

		function onDownload(
			event: Event,
			item: DownloadItem,
			contents: WebContents,
		) {
			const chain = item.getURLChain();
			if (!matches(contents) || chain[0] !== url) return;
			cleanup();
			try {
				signal?.throwIfAborted();
				configure(item);
			} catch (error) {
				event.preventDefault();
				reject(error);
				return;
			}
			attached?.();
			const cancel = () => item.cancel();
			const update = () => progress?.(item);
			if (progress) item.on("updated", update);
			item.once("done", (_event, state) => {
				item.off("updated", update);
				signal?.removeEventListener("abort", cancel);
				if (signal?.aborted) reject(signal.reason);
				else if (state === "interrupted")
					reject(new Error("Media download was interrupted."));
				else resolve(state === "completed" ? item.getSavePath() : null);
			});
			signal?.addEventListener("abort", cancel, { once: true });
			update();
		}

		const timeout = setTimeout(() => {
			cleanup();
			reject(signal?.reason ?? new Error("Media download did not start."));
		}, 30_000);
		timeout.unref();
		session.on("will-download", onDownload);
		try {
			begin();
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}

export function downloadPercent(item: DownloadItem) {
	const percent = item.getPercentComplete();
	return percent < 0 ? null : Math.min(percent, 100);
}
