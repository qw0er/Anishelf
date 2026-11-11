import {
	PlayerContinuation,
	PlayerViewingControl,
} from "../../features/anime/ui.js";
import { PlaybackPreparation } from "../../features/media/ui.js";
import type { PlaybackUiSlots } from "../../features/playback/public.js";
export const playbackUiSlots: PlaybackUiSlots = {
	renderContinuation: (input) => <PlayerContinuation {...input} />,
	renderViewing: (input) => <PlayerViewingControl {...input} />,
	renderPreparation: ({ key, ...props }) => (
		<PlaybackPreparation key={key} {...props} />
	),
};
