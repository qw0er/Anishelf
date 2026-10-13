import type {
	PreparationApi,
	PreparationView,
} from "../../modules/media/preparation/public.js";
import type {
	PlaybackCopies,
	PlaybackCopy,
} from "../../modules/playback/playback-selection/ports.js";

function playbackCopy({
	task,
	artifact,
	availability,
}: PreparationView): PlaybackCopy {
	return {
		taskId: task.id,
		profileId: task.profileId,
		source: { ...task.spec.source },
		audioStreamIndices: [...task.spec.settings.audioStreamIndices],
		mode: task.spec.settings.mode,
		pending: ["queued", "processing", "cancelling"].includes(task.state.status),
		updatedAtMs: task.state.updatedAtMs,
		artifact: artifact
			? { id: artifact.id, mimeType: artifact.mimeType }
			: null,
		availability,
	};
}
/** The composition boundary translates the owner's view into the consumer's capability. */
export function createPlaybackCopies(
	preparation: Pick<PreparationApi, "list" | "get">,
): PlaybackCopies {
	return {
		list: async (fileId) => ({
			tasks: (await preparation.list(fileId)).tasks.map(playbackCopy),
		}),
		get: async (id) => playbackCopy(await preparation.get(id)),
	};
}
