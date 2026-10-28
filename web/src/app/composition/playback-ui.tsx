import { PlayerViewingControl } from "../../features/anime/ui.js";
import { subtitlePolicy } from "../../features/media/public.js";
import {
	PlaybackPreparation,
	SubtitleTracks,
} from "../../features/media/ui.js";
import type { PlaybackUiSlots } from "../../features/playback/public.js";
export const playbackUiSlots: PlaybackUiSlots = {
	renderViewing: (input) => <PlayerViewingControl {...input} />,
	renderPreparation: ({ key, ...props }) => (
		<PlaybackPreparation key={key} {...props} />
	),
	renderSubtitles: (fileId) => (
		<SubtitleTracks fileId={fileId} policy={subtitlePolicy} />
	),
};
