import {
	directPlaybackPlan,
	originalTimeline,
} from "../../../../contracts/media.js";
import { presentCompatibility } from "../../../../transport/presenters/compatibility.js";

export function playbackSelectionResponse(
	result: import("../public.js").PlaybackSelection,
): import("../../../../contracts/http.js").PlaybackSelectionResponse {
	const { choice } = result;
	return {
		sourceVersion: result.sourceVersion,
		compatibility: result.compatibility
			? presentCompatibility(result.compatibility)
			: null,
		pending: result.pending,
		plan:
			choice.kind === "direct"
				? directPlaybackPlan(choice.fileId, choice.mimeType)
				: choice.kind === "blocked"
					? { mode: "blocked", reason: choice.reason }
					: {
							mode: "prepared",
							artifactId: choice.artifactId,
							resource: {
								delivery: "file",
								url: `/api/prepared-media/${choice.artifactId}`,
								mimeType: choice.mimeType,
								timeline: originalTimeline(),
							},
						},
	};
}
