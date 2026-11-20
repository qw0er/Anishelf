import type {
	ClientPlatform,
	VideoDownloadProgress,
} from "@anishelf/client-ui/browser-platform";
import type { DesktopBridge } from "../../ipc/desktop.js";

export function createVideoDownloads(
	desktop: DesktopBridge,
): NonNullable<ClientPlatform["videoDownloads"]> {
	const progress = new Map<string, VideoDownloadProgress>();
	const listeners = new Set<() => void>();

	function notify() {
		for (const listener of listeners) listener();
	}

	return {
		getProgress: (key) => progress.get(key),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start(key, resolve) {
			if (progress.has(key)) return;
			const id = crypto.randomUUID();
			progress.set(key, { status: "preparing" });
			notify();
			try {
				const { url, name } = await resolve();
				const unsubscribe = desktop.onDownloadProgress(
					(downloadId, percent) => {
						if (downloadId !== id) return;
						progress.set(key, { status: "downloading", percent });
						notify();
					},
				);
				try {
					if (await desktop.downloadFile(url, name, id))
						return { name, reveal: () => desktop.revealDownload(id) };
				} finally {
					unsubscribe();
				}
			} finally {
				progress.delete(key);
				notify();
			}
		},
	};
}
