import { playbackSelectionConstraints } from "@anishelf/backend/contracts/defaults";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { PlaybackSelectionResponse } from "../../../../shared/api/contracts.js";
import {
	clearCapabilityCache,
	preparationInteractionDefaults,
	queryCapabilities,
} from "../../../media/public.js";
import { getPlaybackOptions, selectPlayback } from "../api.js";
import { canSelectNativeAudio, type PlaybackFailure } from "../runtime.js";

/** Negotiate actual assets once per intent. Background jobs cannot replace an active binding. */
export function usePlaybackSelection(
	fileId: string,
	sourceVersion: string | undefined,
	scope: string,
	audioStreamIndex?: number | null,
	enabled = true,
	assetId?: string,
) {
	const instance = useId();
	const [revision, setRevision] = useState(0);
	const [runtimeFailure, setRuntimeFailure] = useState<PlaybackFailure | null>(
		null,
	);
	const failed = useRef<string[]>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new user intent resets attempt-local failures
	useEffect(() => {
		failed.current = [];
		setRuntimeFailure(null);
	}, [fileId, scope, audioStreamIndex, assetId]);
	const baseKey = [
		"playback-selection",
		instance,
		fileId,
		scope,
		audioStreamIndex,
		assetId,
		revision,
	] as const;
	const client = useQueryClient();
	const cached = client.getQueryData<PlaybackSelectionResponse>(baseKey);
	const queryKey =
		sourceVersion && cached && cached.source.sourceVersion !== sourceVersion
			? [...baseKey, sourceVersion]
			: baseKey;
	const query = useQuery({
		queryKey,
		enabled,
		staleTime: Infinity,
		refetchOnMount: false,
		queryFn: async ({ signal: querySignal }) => {
			const active = client.getQueryData<PlaybackSelectionResponse>(queryKey);
			if (active?.active) return active;
			const signal = AbortSignal.any([
				querySignal,
				AbortSignal.timeout(
					preparationInteractionDefaults.preparationRequestTimeoutMs,
				),
			]);
			const intent = {
				fileId,
				...(sourceVersion ? { sourceVersion } : {}),
				...(audioStreamIndex !== undefined ? { audioStreamIndex } : {}),
				...(assetId ? { assetId, allowUnverified: true } : {}),
				canSelectAudio: canSelectNativeAudio(),
				failedResourceIds: [...failed.current],
			};
			const options = await getPlaybackOptions(intent, { signal });
			const evidence = await Promise.all(
				options.assets.map(async (inspection) => ({
					assetId: inspection.asset.id,
					descriptionId: inspection.descriptionId,
					evidence: await queryCapabilities(inspection.queries, signal),
				})),
			);
			const selection = await selectPlayback(
				{ ...intent, sourceVersion: options.source.sourceVersion, evidence },
				{ signal },
			);
			signal.throwIfAborted();
			return selection;
		},
		refetchInterval: (current) =>
			current.state.data &&
			!current.state.data.active &&
			current.state.data.pending
				? preparationInteractionDefaults.preparationPollIntervalMs
				: false,
	});
	const current = {
		loading: enabled && query.isPending,
		selection: query.data ?? null,
		error: query.error,
	};
	const currentRef = useRef(current);
	currentRef.current = current;

	return {
		...current,
		runtimeFailure,
		retry: () => {
			clearCapabilityCache();
			failed.current = [];
			setRuntimeFailure(null);
			setRevision((value) => value + 1);
		},
		failed: (failure: PlaybackFailure) => {
			setRuntimeFailure(failure);
			const active = currentRef.current.selection?.active;
			if (
				!active ||
				(failure.kind !== "decode" && failure.kind !== "unsupported")
			)
				return;
			failed.current = [...new Set([...failed.current, active.asset.id])].slice(
				-playbackSelectionConstraints.maximumFailedResources,
			);
			setRevision((value) => value + 1);
		},
	};
}
