import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type {
	FileResponse,
	PreparationTaskResponse,
} from "../../../api/contracts.js";
import { profilesQuery } from "../../../api/queries.js";
import { toast } from "../../../components/ui/toast.js";
import { playbackPolicy } from "../../../config/media-policy.js";
import { originalCompatibilityKey } from "../../../lib/media-compatibility.js";
import { parseAudioSelection } from "../../../routes/playback-params.js";
import { useFilePreparations } from "../../preparation/public.js";
import { usePlaybackSelection } from "./use-playback-selection.js";
import { usePlaybackSession } from "./use-playback-session.js";

/** Coordinate intent, delivery and progress without allowing task polling to own media lifecycle. */
export function usePlaybackController(data: FileResponse, scope: string) {
	const [searchParams, setSearchParams] = useSearchParams();
	const audio = searchParams.get("audio");
	const parsed = useMemo(() => parseAudioSelection(audio), [audio]);
	const playback = usePlaybackSession(data.file.id, playbackPolicy);
	const prepared = useFilePreparations(data.file.id);
	const { data: catalog } = useQuery(profilesQuery());
	// A scan revision refreshes folder facts, not an unchanged player's media/subtitle instances.
	let root = scope;
	try {
		const value: unknown = JSON.parse(scope);
		if (Array.isArray(value)) root = JSON.stringify(value[0]);
	} catch {
		/* Callers may provide an opaque scope. */
	}
	const sourceScope = originalCompatibilityKey(data.file, root);
	const selected = usePlaybackSelection(
		data.file.id,
		playback.session?.sourceVersion,
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
