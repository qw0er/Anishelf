import { playbackSelectionConstraints } from "@anishelf/backend/contracts/defaults";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
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
	enabled = true,
) {
	const instance = useId();
	const [revision, setRevision] = useState(0);
	const [attempt, setAttempt] = useState(false);
	const [runtimeFailed, setRuntimeFailed] = useState(false);
	const failed = useRef<string[]>([]);
	const identity = JSON.stringify([
		instance,
		failed.current,
		fileId,
		scope,
		audioStreamIndices,
		revision,
		attempt,
	]);
	const lastCompatibility = useRef<CompatibilityResult | null>(null);
	const client = useQueryClient();
	// biome-ignore lint/correctness/useExhaustiveDependencies: a changed playback intent resets runtime failures
	useEffect(() => {
		failed.current = [];
		lastCompatibility.current = null;
		setAttempt(false);
		setRuntimeFailed(false);
	}, [fileId, scope, JSON.stringify(audioStreamIndices)]);
	const baseKey = ["playback-selection", identity] as const;
	const cached = client.getQueryData<PlaybackSelectionResponse>(baseKey);
	const queryKey =
		sourceVersion && cached && cached.sourceVersion !== sourceVersion
			? [...baseKey, sourceVersion]
			: baseKey;
	const query = useQuery({
		queryKey,
		enabled,
		staleTime: Infinity,
		refetchOnMount: false,
		queryFn: async ({ signal: querySignal }) => {
			const signal = AbortSignal.any([
				querySignal,
				AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
			]);
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

			if (attempt) {
				const selection = await selectPlayback(
					{ ...intent, candidates: [] },
					{ signal },
				);
				signal.throwIfAborted();
				return selection;
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
			signal.throwIfAborted();
			return selection;
		},
		refetchInterval: (query) =>
			query.state.data?.plan.mode === "blocked" && query.state.data.pending
				? interactionPolicy.preparationPollIntervalMs
				: false,
	});
	const current = {
		identity,
		loading: query.isPending,
		selection: query.data ?? null,
		error: query.error,
	};
	if (current.selection?.compatibility)
		lastCompatibility.current = current.selection.compatibility;
	const currentRef = useRef(current);
	currentRef.current = current;
	const previousPreparationRevision = useRef(preparationRevision);
	useEffect(() => {
		if (previousPreparationRevision.current === preparationRevision) return;
		previousPreparationRevision.current = preparationRevision;
		if (currentRef.current.selection?.plan.mode === "blocked")
			setRevision((value) => value + 1);
	}, [preparationRevision]);

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
