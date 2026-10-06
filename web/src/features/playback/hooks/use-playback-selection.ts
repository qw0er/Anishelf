import { playbackSelectionConstraints } from "@anishelf/backend/contracts/defaults";
import { useEffect, useRef, useState } from "react";
import { getPlaybackOptions, selectPlayback } from "../../../api/client.js";
import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
	CompatibilityResult,
	PlaybackSelectionResponse,
} from "../../../api/contracts.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import {
	clearCapabilityCache,
	queryCapabilities,
} from "../../../lib/media-capabilities.js";

/** Browser collects evidence; the server alone filters and chooses delivery resources. */
export function usePlaybackSelection(
	fileId: string,
	sourceVersion: string | undefined,
	scope: string,
	audioStreamIndices?: number[],
	preparationRevision = "",
) {
	const [revision, setRevision] = useState(0);
	const [attempt, setAttempt] = useState(false);
	const [runtimeFailed, setRuntimeFailed] = useState(false);
	const failed = useRef<string[]>([]);
	const identity = JSON.stringify([
		fileId,
		scope,
		audioStreamIndices,
		revision,
		attempt,
	]);
	const [state, setState] = useState<{
		identity: string;
		loading: boolean;
		selection: PlaybackSelectionResponse | null;
		error: unknown;
	}>({ identity, loading: true, selection: null, error: null });
	const lastCompatibility = useRef<CompatibilityResult | null>(null);
	const currentRef = useRef(state);
	currentRef.current = state;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a changed playback intent resets runtime failures
	useEffect(() => {
		failed.current = [];
		lastCompatibility.current = null;
		setAttempt(false);
		setRuntimeFailed(false);
	}, [fileId, scope, JSON.stringify(audioStreamIndices)]);
	// Source/session arrival does not renegotiate an already matching source.
	useEffect(() => {
		if (
			currentRef.current.identity === identity &&
			currentRef.current.selection &&
			(!sourceVersion ||
				currentRef.current.selection.sourceVersion === sourceVersion)
		)
			return;
		const controller = new AbortController();
		const signal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
		]);
		setState({ identity, loading: true, selection: null, error: null });
		const intent = {
			fileId,
			...(sourceVersion ? { sourceVersion } : {}),
			...(audioStreamIndices !== undefined ? { audioStreamIndices } : {}),
			tryOriginal: attempt,
			failedResourceIds: failed.current,
		};
		async function check(
			description: CompatibilityInspection,
			original = false,
		): Promise<CompatibilityCheckRequest> {
			const selection = original
				? audioStreamIndices
				: description.selectedAudioStreamIndices;
			return {
				sourceVersion: description.sourceVersion,
				descriptionId: description.descriptionId,
				...(selection !== undefined ? { audioStreamIndices: selection } : {}),
				output: description.output
					? {
							profileId: description.output.profileId,
							target: description.output.target,
						}
					: null,
				evidence: await queryCapabilities(description.queries, signal, true),
			};
		}
		void (async () => {
			if (attempt) {
				const selection = await selectPlayback(
					{ ...intent, candidates: [] },
					{ signal },
				);
				if (!signal.aborted)
					setState({ identity, loading: false, selection, error: null });
				return;
			}
			const options = await getPlaybackOptions(intent, { signal });
			const original = await check(options.original, true);
			const candidates = await Promise.all(
				options.candidates.map(async (candidate) => ({
					taskId: candidate.taskId,
					check: await check(candidate.description),
				})),
			);
			const selection = await selectPlayback(
				{ ...intent, original, candidates },
				{ signal },
			);
			if (!signal.aborted)
				setState({ identity, loading: false, selection, error: null });
		})().catch((error) => {
			if (!controller.signal.aborted)
				setState({ identity, loading: false, selection: null, error });
		});
		return () => controller.abort();
	}, [identity, fileId, sourceVersion, audioStreamIndices, attempt]);
	if (state.selection?.compatibility)
		lastCompatibility.current = state.selection.compatibility;
	const current =
		state.identity === identity &&
		(!sourceVersion ||
			!state.selection ||
			state.selection.sourceVersion === sourceVersion)
			? state
			: { identity, loading: true, selection: null, error: null };
	const previousPreparationRevision = useRef(preparationRevision);
	useEffect(() => {
		if (previousPreparationRevision.current === preparationRevision) return;
		previousPreparationRevision.current = preparationRevision;
		if (currentRef.current.selection?.plan.mode === "blocked")
			setRevision((value) => value + 1);
	}, [preparationRevision]);
	// Only blocked pending playback polls. Background completion cannot replace active bytes.
	useEffect(() => {
		if (
			current.selection?.plan.mode !== "blocked" ||
			!current.selection.pending
		)
			return;
		const timer = setTimeout(
			() => setRevision((v) => v + 1),
			interactionPolicy.preparationPollIntervalMs,
		);
		return () => clearTimeout(timer);
	}, [current.selection]);

	return {
		...current,
		result:
			current.selection?.compatibility ??
			(attempt ? lastCompatibility.current : null),
		runtimeFailed,
		retry: () => {
			clearCapabilityCache();
			failed.current = [];
			setAttempt(false);
			setRuntimeFailed(false);
			setRevision((v) => v + 1);
		},
		tryDirect: () => {
			setAttempt(true);
			setRuntimeFailed(false);
			failed.current = failed.current.filter((id) => id !== fileId);
			setRevision((v) => v + 1);
		},
		failed: () => {
			const plan = current.selection?.plan;
			const id = plan?.mode === "prepared" ? plan.artifactId : fileId;
			if (!failed.current.includes(id))
				failed.current = [...failed.current, id].slice(
					-playbackSelectionConstraints.maximumFailedResources,
				);
			setRuntimeFailed(true);
			setAttempt(false);
			setRevision((v) => v + 1);
		},
	};
}
