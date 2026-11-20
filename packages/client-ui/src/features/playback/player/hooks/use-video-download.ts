import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../../../../shared/api/client.js";
import { getClientRuntime } from "../../../../shared/api/connection.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import { resolveMediaLink } from "../media-link.js";

function subscribeToIdle() {
	return () => {};
}

export function useVideoDownload(fileId: string, enabled: boolean) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const scope = useQueryScope();
	const runtime = getClientRuntime();
	const downloads = enabled ? runtime.platform.videoDownloads : undefined;
	const key = JSON.stringify([scope, fileId]);
	const progress = useSyncExternalStore(
		downloads?.subscribe ?? subscribeToIdle,
		() => downloads?.getProgress(key),
	);

	async function start() {
		const { signal } = runtime.connection;
		if (!downloads || signal.aborted || downloads.getProgress(key)) return;
		const id = `video-download:${key}`;
		toast.close(id);
		try {
			const saved = await downloads.start(key, () =>
				resolveMediaLink(fileId, { signal }, client, scope),
			);
			if (!saved || signal.aborted) return;
			toast.add({
				id,
				type: "success",
				title: t("player.videoDownloadSaved"),
				description: saved.name,
				actionProps: {
					children: t("player.videoDownloadReveal"),
					onClick: () => {
						void saved.reveal().catch(() => {
							console.warn("platform.reveal_download_failed");
							toast.close(id);
							toast.add({
								type: "error",
								title: t("player.videoDownloadRevealFailed"),
							});
						});
					},
				},
			});
		} catch (error) {
			if (signal.aborted || isRequestCancelled(error)) return;
			console.warn("platform.video_download_failed", { fileId });
			toast.add({
				id,
				type: "error",
				priority: "high",
				title: t("player.videoDownloadFailed"),
				description: t(
					getErrorTranslationKey(error) ?? "player.videoDownloadRetry",
				),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => void start(),
				},
			});
		}
	}

	return downloads ? { progress, start } : undefined;
}
