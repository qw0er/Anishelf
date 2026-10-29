import {
	PlayerContinuation,
	PlayerViewingControl,
} from "../../features/anime/ui.js";
import { subtitlePolicy } from "../../features/media/public.js";
import {
	PlaybackPreparation,
	SubtitleTracks,
} from "../../features/media/ui.js";
import type { PlaybackUiSlots } from "../../features/playback/public.js";
import { AutomaticContinuationSetting } from "../../features/settings/ui.js";
export const playbackUiSlots: PlaybackUiSlots = {
	renderOptions: () => <AutomaticContinuationSetting />,
	renderContinuation: (input) => <PlayerContinuation {...input} />,
	renderViewing: (input) => <PlayerViewingControl {...input} />,
	renderPreparation: ({ key, ...props }) => (
		<PlaybackPreparation key={key} {...props} />
	),
	renderSubtitles: (fileId) => (
		<SubtitleTracks fileId={fileId} policy={subtitlePolicy} />
	),
};
