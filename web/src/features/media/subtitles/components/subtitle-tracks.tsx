import { useQueryClient } from "@tanstack/react-query";
import { useMediaPlayer } from "@vidstack/react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "../../../../shared/components/ui/toast.js";
import { interactionDefaults } from "../../../../shared/config/interaction-defaults.js";
import { SubtitleController } from "../controller.js";
import { useSubtitleDiscovery } from "../hooks/use-subtitle-discovery.js";
import type { SubtitlePolicy } from "../policy.js";
import { prepareSelectedSubtitle } from "../preparation.js";
import { StyledSubtitleRenderer } from "../renderer.js";

/** Vidstack loads/parses tracks and controls the text renderer lifecycle. */
export function SubtitleTracks({
	fileId,
	policy,
	onPreparingChange,
}: {
	fileId: string;
	policy: SubtitlePolicy;
	onPreparingChange?: (label: string | null) => void;
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
	const client = useQueryClient();
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
					client,
				),
			(feedback) => {
				toast.close(notificationId);
				toast.close(`subtitle-fonts:${fileId}`);
				onPreparingChange?.(
					feedback?.status === "preparing"
						? t("subtitles.preparing", { name: feedback.name })
						: null,
				);
				if (!feedback || feedback.status === "preparing") return;
				console.debug("[Subtitles] Preparation result notified.", {
					fileId,
					status: feedback.status,
					code: feedback.errorCode,
				});
				toast.add({
					id: notificationId,
					type: feedback.status === "warning" ? "warning" : "error",
					timeout: interactionDefaults.persistentToastTimeoutMs,
					title: t(
						feedback.status === "warning"
							? "subtitles.fontFallback"
							: "subtitles.failed",
						{ name: feedback.name },
					),
					priority: "high",
					description: t(`subtitles.errors.${feedback.errorCode}`, {
						defaultValue: t("subtitles.errors.SUBTITLE_EXTRACTION_FAILED"),
					}),
					actionProps: {
						children: t("subtitles.retry"),
						onClick: () => controllerRef.current?.retry(),
					},
				});
			},
		);
		controllerRef.current = controller;
		return () => {
			controller.dispose();
			onPreparingChange?.(null);
			toast.close(notificationId);
			controllerRef.current = null;
		};
	}, [player, discovery, fileId, t, client, onPreparingChange]);
	useEffect(() => {
		if (!player) return;
		const renderer = new StyledSubtitleRenderer(stablePolicy, (track) => {
			toast.add({
				id: `subtitle-fonts:${fileId}`,
				type: "warning",
				timeout: 0,
				title: t("subtitles.fontFallback", { name: track.label }),
				description: t("subtitles.errors.FONT_FALLBACK"),
				actionProps: {
					children: t("subtitles.retry"),
					onClick: () => controllerRef.current?.retry(),
				},
			});
		});
		player.textRenderers.add(renderer);
		return () => {
			player.textRenderers.remove(renderer);
			toast.close(`subtitle-fonts:${fileId}`);
		};
	}, [player, stablePolicy, fileId, t]);
	return null;
}
