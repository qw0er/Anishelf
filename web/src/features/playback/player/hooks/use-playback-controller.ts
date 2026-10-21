import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type {
	FileResponse,
	PreparationTaskResponse,
} from "../../../../shared/api/contracts.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import {
	originalCompatibilityKey,
	useFilePreparations,
} from "../../../media/public.js";
import { profilesQuery } from "../../../settings/public.js";
import { parseAudioSelection } from "../playback-params.js";
import { playbackPolicy } from "../policy.js";
import { usePlaybackSelection } from "./use-playback-selection.js";
import { usePlaybackSession } from "./use-playback-session.js";

/** Coordinate intent, delivery and progress without allowing task polling to own media lifecycle. */
export function usePlaybackController(data: FileResponse) {
	const [searchParams, setSearchParams] = useSearchParams();
	const audio = searchParams.get("audio");
	const parsed = useMemo(() => parseAudioSelection(audio), [audio]);
	const playback = usePlaybackSession(data.file.id, playbackPolicy);
	const prepared = useFilePreparations(data.file.id);
	const { data: catalog } = useQuery(profilesQuery());
	const sourceScope = originalCompatibilityKey(data.file);
	const selected = usePlaybackSelection(
		data.file.id,
		searchParams.get("version") ?? playback.session?.sourceVersion,
		sourceScope,
		parsed.indices,
		JSON.stringify([
			catalog?.selectedProfileId,
			prepared.tasks.map((task) => [task.id, task.status, task.updatedAtMs]),
		]),
		parsed.valid,
	);
	const compatibility = parsed.valid
		? selected
		: {
				...selected,
				loading: false,
				selection: null,
				result: null,
				error: new Error("INVALID_AUDIO_SELECTION"),
			};
	useEffect(
		() => () => toast.close(`video-playback:${data.file.id}`),
		[data.file.id],
	);
	const audioTracks = compatibility.result?.audioTracks ?? [];
	const selectedPlan = compatibility.selection?.plan;
	const resource =
		selectedPlan?.mode === "direct" || selectedPlan?.mode === "prepared"
			? selectedPlan.resource
			: null;
	function selectAudio(value: string | null) {
		const next = new URLSearchParams(searchParams);
		if (value === null) next.delete("audio");
		else next.set("audio", value);
		setSearchParams(next, { replace: true });
	}
	function onPrepared(task: PreparationTaskResponse) {
		if (task.audioStreamIndices === undefined) return;
		const all = audioTracks.map(({ stream }) => stream.index);
		selectAudio(
			JSON.stringify(task.audioStreamIndices) === JSON.stringify(all)
				? null
				: task.audioStreamIndices.join(","),
		);
	}
	return {
		audio,
		audioValid: parsed.valid,
		audioStreamIndices: parsed.indices,
		playback,
		prepared,
		compatibility,
		audioTracks,
		selectedPlan,
		resource,
		sourceScope: JSON.stringify([
			sourceScope,
			compatibility.selection?.sourceVersion,
		]),
		selectAudio,
		onPrepared,
		recheck: () => {
			compatibility.retry();
			prepared.refresh();
		},
	};
}
