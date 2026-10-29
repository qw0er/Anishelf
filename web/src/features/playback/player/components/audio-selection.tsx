import { Headphones } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ActivePlayback } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../../shared/components/ui/native-select.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
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
	const position = selected ? tracks.indexOf(selected) : -1;
	const summary = selected
		? audioTrackLabel(
				{
					...selected.stream,
					label: selected.stream.language
						? null
						: (selected.stream.label ?? null),
					default: false,
				},
				position,
				t,
				i18n.language,
			)
		: t("audioTracks.none");
	return (
		<div className="mr-auto flex min-h-9 min-w-0 max-w-full items-center gap-2 sm:max-w-80">
			<Headphones
				className="size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			{tracks.length > 1 && canSelectNativeAudio() ? (
				<NativeSelect
					className="min-w-0 max-w-56 truncate text-sm"
					aria-label={t("audioTracks.playback")}
					value={active.audio ? String(active.audio.sourceStreamIndex) : "none"}
					onChange={(event) => selectAudio(event.target.value)}
				>
					{tracks.map((track, position) => (
						<NativeSelectOption
							key={track.stream.index}
							value={String(track.sourceStreamIndex)}
						>
							{label(position)}
						</NativeSelectOption>
					))}
				</NativeSelect>
			) : (
				<Tooltip content={label(position)} openOnClick>
					<Button
						variant="ghost"
						className="min-w-0 justify-start px-2"
						aria-label={t("audioTracks.playback")}
					>
						<span className="truncate">{summary}</span>
					</Button>
				</Tooltip>
			)}
		</div>
	);
}
