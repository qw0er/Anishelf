import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type {
	FileResponse,
	MediaAsset,
} from "../../../../shared/api/contracts.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { originalCompatibilityKey } from "../../../media/public.js";
import { parseAudioSelection } from "../playback-params.js";
import { playbackPolicy } from "../policy.js";
import { usePlaybackSelection } from "./use-playback-selection.js";
import { usePlaybackSession } from "./use-playback-session.js";

export function usePlaybackController(data: FileResponse) {
	const [searchParams, setSearchParams] = useSearchParams();
	const audio = searchParams.get("audio");
	const parsed = useMemo(() => parseAudioSelection(audio), [audio]);
	const playback = usePlaybackSession(data.file.id, playbackPolicy);
	const scope = originalCompatibilityKey(data.file);
	const selected = usePlaybackSelection(
		data.file.id,
		searchParams.get("version") ?? playback.session?.sourceVersion,
		scope,
		parsed.index,
		parsed.valid,
		searchParams.get("asset") ?? undefined,
	);
	const selection = parsed.valid
		? selected
		: {
				...selected,
				loading: false,
				selection: null,
				error: new Error("INVALID_AUDIO_SELECTION"),
			};
	useEffect(
		() => () => toast.close(`video-playback:${data.file.id}`),
		[data.file.id],
	);
	function selectAudio(value: string) {
		const active = selection.selection?.active;
		if (!active) return;
		const next = new URLSearchParams(searchParams);
		next.set("audio", value);
		next.set("asset", active.asset.id);
		console.info("[playback] Current asset audio selected.", {
			assetId: active.asset.id,
			sourceAudioStreamIndex: Number(value),
		});
		setSearchParams(next, { replace: true });
	}

	function selectAsset(asset: MediaAsset | null) {
		const next = new URLSearchParams(searchParams);
		if (asset === null) next.delete("asset");
		else {
			next.set("asset", asset.id);
			const wanted = selection.selection?.resolvedAudioStreamIndex;
			if (
				!asset.audioTracks.some((track) => track.sourceStreamIndex === wanted)
			) {
				const track = asset.audioTracks[0];
				next.set("audio", track ? String(track.sourceStreamIndex) : "none");
			}
		}
		setSearchParams(next, { replace: true });
	}
	function tryOrigin() {
		const next = new URLSearchParams(searchParams);
		next.set("asset", data.file.id);
		if (!parsed.valid) next.delete("audio");
		setSearchParams(next, { replace: true });
		selection.retry();
	}

	return {
		audio,
		audioValid: parsed.valid,
		playback,
		selection,
		source: selection.selection?.source ?? null,
		active: selection.selection?.active ?? null,
		selectedAssetId: searchParams.get("asset") ?? "auto",
		sourceScope: JSON.stringify([
			scope,
			selection.selection?.source.sourceVersion,
		]),
		selectAudio,
		selectAsset,
		tryOrigin,
		onAssetsChanged: () => {
			if (!selection.selection?.active) selection.retry();
		},
		recheck: () => {
			selection.retry();
		},
	};
}
