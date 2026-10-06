import type { CompatibilityResult } from "../../contracts/http.js";
import type { CompatibilityResult as NegotiationReport } from "../../shared/media-negotiation.js";
import type { DeepReadonly } from "../../shared/policy.js";

/** Explicitly omit canonical source paths and executable profile parameters. */
export function presentCompatibility(
	checked: DeepReadonly<NegotiationReport>,
): CompatibilityResult {
	return {
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
	};
}
