import { Track, useMediaPlayer } from "@vidstack/react";
import { useEffect, useMemo } from "react";
import { subtitleContentUrl } from "../api/client.js";
import type { ClientConfigResponse } from "../api/contracts.js";
import { useExternalSubtitles } from "../hooks/use-external-subtitles.js";
import { StyledSubtitleRenderer } from "../subtitles/renderer.js";

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
				.filter((descriptor) => policy.formats.includes(descriptor.format))
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
