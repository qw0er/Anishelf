import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import type { PlaybackSelectionResponse } from "../../../../shared/api/contracts.js";
import { preparationInteractionDefaults } from "../../../media/public.js";
import { selectPlayback } from "../api.js";
import type { PlaybackFailure } from "../runtime.js";

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new user intent resets attempt-local failures
	useEffect(() => {
		setRuntimeFailure(null);
	}, [fileId, scope, audioStreamIndex, assetId]);
	const keyFor = (
		audio: number | null | undefined,
		asset: string | undefined,
	) =>
		[
			"playback-selection",
			instance,
			fileId,
			scope,
			audio,
			asset,
			revision,
		] as const;
	const baseKey = keyFor(audioStreamIndex, assetId);
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
				...(assetId ? { assetId } : {}),
			};
			const selection = await selectPlayback(intent, { signal });
			signal.throwIfAborted();
			return selection;
		},
	});
	const current = {
		loading: enabled && query.isPending,
		selection: query.data ?? null,
		error: query.error,
	};

	return {
		...current,
		runtimeFailure,
		retainAudio(sourceIndex: number | null) {
			const selected = query.data;
			const active = selected?.active;
			if (!selected || !active) return;
			const position = active.asset.audioTracks.findIndex(
				(item) => item.sourceStreamIndex === sourceIndex,
			);
			const track = active.asset.audioTracks[position];
			if (sourceIndex !== null && !track) return;
			// The player already selected this stream in the current asset.
			client.setQueryData<PlaybackSelectionResponse>(
				keyFor(sourceIndex, active.asset.id),
				{
					...selected,
					resolvedAudioStreamIndex: sourceIndex,
					active: {
						...active,
						audio: track
							? {
									streamIndex: track.stream.index,
									sourceStreamIndex: track.sourceStreamIndex,
									position,
								}
							: null,
					},
				},
			);
		},
		retry: () => {
			setRuntimeFailure(null);
			setRevision((value) => value + 1);
		},
		failed: (failure: PlaybackFailure) => {
			setRuntimeFailure(failure);
		},
		recovered: () => setRuntimeFailure(null),
	};
}
