import { directPlaybackPlan, originalTimeline } from "../../contracts/media.js";
import type { PreparationCreation } from "../../modules/preparation/public.js";

/** Transport owns URLs and the small user-visible progress projection. */
export function preparationTaskResponse(
	view: import("../../modules/preparation/public.js").PreparationView,
): import("../../contracts/http.js").PreparationTaskResponse {
	const { task, artifact, availability } = view;
	const progress = task.state.progress;
	return {
		id: task.id,
		fileId: task.spec.source.fileId,
		sourceVersion: task.spec.source.sourceVersion,
		filename: task.filename,
		profileId: task.profileId,
		audioStreamIndices: [...task.spec.settings.audioStreamIndices],
		mode: task.spec.settings.mode,
		reasons: { ...task.spec.settings.reasons },
		status: task.state.status,
		progress: progress
			? {
					mediaTimeMs: progress.mediaTimeMs,
					percent: progress.percent,
					speed: progress.speed,
				}
			: null,
		failureReason: task.state.failureReason,
		createdAtMs: task.createdAtMs,
		updatedAtMs: task.state.updatedAtMs,
		playbackAvailability: availability,
		artifactId: artifact?.id ?? null,
		sizeBytes: artifact?.sizeBytes ?? null,
		resource:
			artifact && availability === "ready"
				? {
						delivery: "file",
						url: `/api/prepared-media/${artifact.id}`,
						mimeType: artifact.mimeType,
						timeline: originalTimeline(),
					}
				: null,
	};
}

export function preparationStartResponse(
	result: PreparationCreation,
): import("../../contracts/http.js").PreparationStartResponse {
	switch (result.kind) {
		case "direct":
			return {
				kind: "direct",
				plan: directPlaybackPlan(result.fileId, result.mimeType),
			};
		case "blocked":
			return { kind: "blocked", reason: result.reason };
		case "task":
			return { kind: "task", task: preparationTaskResponse(result.view) };
	}
}
