import { Track, useMediaPlayer } from "@vidstack/react";
import { useEffect } from "react";
import { subtitleContentUrl } from "../api/client.js";
import { useExternalSubtitles } from "../hooks/use-external-subtitles.js";
import { StyledSubtitleRenderer } from "../subtitles/renderer.js";

/** Vidstack loads/parses tracks and controls the text renderer lifecycle. */
export function ExternalSubtitleTracks({ fileId }: { fileId: string }) {
	const player = useMediaPlayer();
	const discovery = useExternalSubtitles(fileId);
	useEffect(() => {
		if (!player) return;
		const renderer = new StyledSubtitleRenderer();
		player.textRenderers.add(renderer);
		return () => {
			player.textRenderers.remove(renderer);
		};
	}, [player]);
	return (
		<>
			{discovery?.tracks.map((descriptor) => (
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
