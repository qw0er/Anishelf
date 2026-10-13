import { type DeepReadonly, freeze } from "../../shared/policy.js";
import type { CompatibilityResult } from "./public.js";
export function compatibilityView(
	checked: DeepReadonly<CompatibilityResult>,
): DeepReadonly<CompatibilityResult> {
	return freeze({
		fileId: checked.fileId,
		sourceVersion: checked.sourceVersion,
		rulesVersion: checked.rulesVersion,
		direct: { ...checked.direct },
		container: { ...checked.container },
		video: { ...checked.video },
		audio: { ...checked.audio },
		selectedVideo: checked.selectedVideo ? { ...checked.selectedVideo } : null,
		defaultAudioStreamIndex: checked.defaultAudioStreamIndex,
		selectedAudioStreamIndices: [...checked.selectedAudioStreamIndices],
		audioTracks: checked.audioTracks.map((track) => ({
			stream: { ...track.stream },
			compatibility: { ...track.compatibility },
		})),
		output: checked.output
			? {
					...checked.output,
					combinations: { ...checked.output.combinations },
					audioTracks: checked.output.audioTracks.map((track) => ({
						...track,
						combinations: { ...track.combinations },
					})),
				}
			: null,
		warnings: [...checked.warnings],
	});
}
