import { Track, useMediaPlayer } from "@vidstack/react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { subtitleContentUrl } from "../api/client.js";
import type {
	ClientConfigResponse,
	SubtitleDiscoveryResponse,
} from "../api/contracts.js";
import { interactionPolicy } from "../config/interaction-policy.js";
import { useExternalSubtitles } from "../hooks/use-external-subtitles.js";
import { EmbeddedSubtitleController } from "../subtitles/embedded.js";
import { prepareSelectedSubtitle } from "../subtitles/preparation.js";
import { StyledSubtitleRenderer } from "../subtitles/renderer.js";
import { toast } from "./ui/toast.js";

/** Vidstack loads/parses tracks and controls the text renderer lifecycle. */
export function ExternalSubtitleTracks({
	fileId,
	policy,
}: {
	fileId: string;
	policy: ClientConfigResponse["subtitles"];
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
				.filter(Boolean) as ClientConfigResponse["subtitles"]["formats"],
		}),
		[initializationTimeoutMs, memoryMaximumBytes, maximumBytes, formatsKey],
	);
	const player = useMediaPlayer();
	const discovery = useExternalSubtitles(fileId);
	const { t } = useTranslation();

	const embedded = useRef<EmbeddedSubtitleController | null>(null);
	useEffect(() => {
		const notificationId = `subtitle-preparation:${fileId}`;
		toast.close(notificationId);
		if (!player || !discovery) return;
		const controller = new EmbeddedSubtitleController(
			player.textTracks,
			discovery.tracks.filter(
				(
					track,
				): track is Extract<
					SubtitleDiscoveryResponse["tracks"][number],
					{ origin: "embedded" }
				> => track.origin === "embedded",
			),
			(trackId, signal) =>
				prepareSelectedSubtitle(
					fileId,
					trackId,
					discovery.sourceVersion,
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
							onClick: () => embedded.current?.retry(),
						},
					}),
				});
			},
		);
		embedded.current = controller;
		return () => {
			controller.dispose();
			toast.close(notificationId);
			embedded.current = null;
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
	return (
		<>
			{discovery?.tracks
				.filter(
					(
						descriptor,
					): descriptor is Extract<
						SubtitleDiscoveryResponse["tracks"][number],
						{ origin: "external" }
					> =>
						descriptor.origin === "external" &&
						policy.formats.includes(descriptor.format),
				)
				.map((descriptor) => (
					<Track
						key={descriptor.id}
						id={descriptor.id}
						src={subtitleContentUrl(
							fileId,
							descriptor.id,
							discovery.sourceVersion,
							descriptor.sourceVersion,
						)}
						label={`${descriptor.name}${descriptor.language ? ` · ${descriptor.language}` : ""} · ${descriptor.format.toUpperCase()}`}
						lang={descriptor.language ?? ""}
						kind="subtitles"
						type={descriptor.format}
					/>
				))}
		</>
	);
}
