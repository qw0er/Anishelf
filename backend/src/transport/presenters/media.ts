import type {
	FilePlaybackResource,
	MediaTimeline,
	PlaybackPlanDto,
} from "../../contracts/http.js";

/** Project nested resources explicitly; never serialize structurally compatible private fields. */
export function playbackPlanDto(plan: PlaybackPlanDto): PlaybackPlanDto {
	switch (plan.mode) {
		case "blocked":
			return { mode: plan.mode, reason: plan.reason };
		case "direct":
			return {
				mode: plan.mode,
				resource: filePlaybackResourceDto(plan.resource),
			};
		case "prepared":
			return {
				mode: plan.mode,
				artifactId: plan.artifactId,
				resource: filePlaybackResourceDto(plan.resource),
			};
	}
}

function timelineDto(timeline: MediaTimeline) {
	return {
		sourceOriginMs: timeline.sourceOriginMs,
		mediaOriginMs: timeline.mediaOriginMs,
		sourceDurationMs: timeline.sourceDurationMs,
	};
}

function filePlaybackResourceDto(
	resource: FilePlaybackResource,
): FilePlaybackResource {
	return {
		delivery: "file",
		url: resource.url,
		mimeType: resource.mimeType,
		timeline: timelineDto(resource.timeline),
	};
}
