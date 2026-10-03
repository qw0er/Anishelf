import { useMediaPlayer } from "@vidstack/react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "../../../components/ui/toast.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import type { SubtitlePolicy } from "../../../config/media-policy.js";
import { SubtitleController } from "../controller.js";
import { useSubtitleDiscovery } from "../hooks/use-subtitle-discovery.js";
import { prepareSelectedSubtitle } from "../preparation.js";
import { StyledSubtitleRenderer } from "../renderer.js";

/** Vidstack loads/parses tracks and controls the text renderer lifecycle. */
export function SubtitleTracks({
	fileId,
	policy,
}: {
	fileId: string;
	policy: SubtitlePolicy;
}) {
	const { initializationTimeoutMs, memoryMaximumBytes, maximumBytes } = policy;
	const formatsKey = policy.formats.join(",");
	const stablePolicy = useMemo(
		() => ({
			initializationTimeoutMs,
			memoryMaximumBytes,
			maximumBytes,
			formats: formatsKey
				.split(",")
				.filter(Boolean) as SubtitlePolicy["formats"],
		}),
		[initializationTimeoutMs, memoryMaximumBytes, maximumBytes, formatsKey],
	);
	const player = useMediaPlayer();
	const discovery = useSubtitleDiscovery(fileId);
	const { t } = useTranslation();

	const controllerRef = useRef<SubtitleController | null>(null);
	useEffect(() => {
		const notificationId = `subtitle-preparation:${fileId}`;
		toast.close(notificationId);
		if (!player || !discovery) return;
		const controller = new SubtitleController(
			player.textTracks,
			discovery.tracks,
			(trackId, signal, subtitleVersion) =>
				prepareSelectedSubtitle(
					fileId,
					trackId,
					discovery.sourceVersion,
					subtitleVersion,
					signal,
				),
			(feedback) => {
				toast.close(notificationId);
				if (!feedback) return;
				const preparing = feedback.status === "preparing";
				toast.add({
					id: notificationId,
					type: preparing ? "info" : "error",
					timeout: preparing
						? interactionPolicy.persistentToastTimeoutMs
						: interactionPolicy.errorToastTimeoutMs,
					title: t(preparing ? "subtitles.preparing" : "subtitles.failed", {
						name: feedback.name,
					}),
					...(!preparing && {
						priority: "high" as const,
						description: t(`subtitles.errors.${feedback.errorCode}`, {
							defaultValue: t("subtitles.errors.SUBTITLE_EXTRACTION_FAILED"),
						}),
						actionProps: {
							children: t("subtitles.retry"),
							onClick: () => controllerRef.current?.retry(),
						},
					}),
				});
			},
		);
		controllerRef.current = controller;
		return () => {
			controller.dispose();
			toast.close(notificationId);
			controllerRef.current = null;
		};
	}, [player, discovery, fileId, t]);
	useEffect(() => {
		if (!player) return;
		const renderer = new StyledSubtitleRenderer(stablePolicy);
		player.textRenderers.add(renderer);
		return () => {
			player.textRenderers.remove(renderer);
		};
	}, [player, stablePolicy]);
	return null;
}
