import { useTranslation } from "react-i18next";
import type { ActivePlayback } from "../../../../shared/api/contracts.js";
import { audioTrackLabel } from "../../../media/public.js";
import { canSelectNativeAudio } from "../runtime.js";
export function AudioSelection({
	active,
	selectAudio,
}: {
	active: ActivePlayback | null;
	selectAudio(value: string): void;
}) {
	const { t, i18n } = useTranslation();
	if (!active) return null;
	const tracks = active.asset.audioTracks;
	const selected = tracks.find(
		(track) => track.stream.index === active.audio?.streamIndex,
	);
	const label = (position: number) => {
		const track = tracks[position];
		return track
			? audioTrackLabel(track.stream, position, t, i18n.language)
			: t("audioTracks.none");
	};
	return (
		<div className="flex min-w-0 max-w-full items-center gap-2">
			<span className="shrink-0 text-sm text-muted-foreground">
				{t("player.audio")}
			</span>
			{tracks.length > 1 && canSelectNativeAudio() ? (
				<select
					className="h-11 min-w-0 max-w-40 rounded-md bg-transparent px-2 text-sm sm:max-w-72"
					aria-label={t("audioTracks.playback")}
					value={active.audio ? String(active.audio.sourceStreamIndex) : "none"}
					onChange={(event) => selectAudio(event.target.value)}
				>
					{tracks.map((track, position) => (
						<option
							key={track.stream.index}
							value={String(track.sourceStreamIndex)}
						>
							{label(position)}
						</option>
					))}
				</select>
			) : (
				<span
					role="status"
					className="min-w-0 text-sm"
					aria-label={t("audioTracks.playback")}
				>
					{label(selected ? tracks.indexOf(selected) : -1)}
				</span>
			)}
		</div>
	);
}
