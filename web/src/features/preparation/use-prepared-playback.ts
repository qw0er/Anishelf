import { useEffect, useState } from "react";
import type { PreparationTaskResponse } from "../../api/contracts.js";
import { interactionPolicy } from "../../config/interaction-policy.js";
import { matchesAudioSelection } from "./audio-tracks.js";
import { usePreparationContext } from "./context.js";
import { verifyPreparedPlayback } from "./negotiation.js";
import { usePreparations } from "./use-preparations.js";

/** Unsupported originals use an existing compatible copy; viewing never enqueues work. */
export function usePreparedPlayback(
	fileId: string,
	sourceVersion: string | undefined,
	enabled: boolean,
	audioStreamIndices?: number[],
	allAudioStreamIndices?: number[],
) {
	const preparation = usePreparationContext();
	const fileTasks = usePreparations(fileId, enabled);
	const [revision, setRevision] = useState(0);
	const tasks = [
		...new Map(
			[...preparation.tasks, ...fileTasks.tasks].map((task) => [task.id, task]),
		).values(),
	];
	const candidates = tasks
		.filter(
			(task) =>
				task.fileId === fileId &&
				matchesAudioSelection(
					task,
					audioStreamIndices,
					allAudioStreamIndices,
				) &&
				(!sourceVersion || task.sourceVersion === sourceVersion) &&
				task.status === "ready" &&
				task.resource?.url,
		)
		.sort(
			(a, b) =>
				Number(b.profileId === preparation.catalog?.selectedProfileId) -
				Number(a.profileId === preparation.catalog?.selectedProfileId),
		);
	const identity = JSON.stringify([
		fileId,
		sourceVersion,
		enabled,
		audioStreamIndices,
		allAudioStreamIndices,
		revision,
		candidates.map((task) => [task.id, task.artifactId, task.updatedAtMs]),
	]);
	const [state, setState] = useState<{
		identity: string;
		loading: boolean;
		task: PreparationTaskResponse | null;
		error: unknown;
	}>({ identity, loading: enabled, task: null, error: null });
	// biome-ignore lint/correctness/useExhaustiveDependencies: identity binds exact ready candidates and source
	useEffect(() => {
		const controller = new AbortController();
		const signal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
		]);
		setState({ identity, loading: enabled, task: null, error: null });
		if (!enabled) return () => controller.abort();
		void (async () => {
			let lastError: unknown = null;
			for (const candidate of candidates) {
				try {
					const task = await verifyPreparedPlayback(candidate, signal);
					if (!signal.aborted)
						setState({ identity, loading: false, task, error: null });
					return;
				} catch (error) {
					if (signal.aborted) break;
					lastError = error;
				}
			}
			if (!controller.signal.aborted)
				setState({ identity, loading: false, task: null, error: lastError });
		})();
		return () => controller.abort();
	}, [identity]);
	const current =
		state.identity === identity
			? state
			: { identity, loading: enabled, task: null, error: null };
	return {
		...current,
		tasks,
		loading: enabled && (current.loading || fileTasks.loading),
		listError: fileTasks.error,
		pending: [...fileTasks.tasks, ...preparation.tasks].some(
			(task) =>
				task.fileId === fileId &&
				matchesAudioSelection(
					task,
					audioStreamIndices,
					allAudioStreamIndices,
				) &&
				(!sourceVersion || task.sourceVersion === sourceVersion) &&
				(task.status === "queued" ||
					task.status === "processing" ||
					task.status === "cancelling"),
		),
		retry: () => {
			preparation.refresh();
			fileTasks.refresh();
			setRevision((v) => v + 1);
		},
	};
}
