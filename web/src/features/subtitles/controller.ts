import { TextTrack, type TextTrackList } from "@vidstack/react";
import type {
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
} from "../../api/contracts.js";

type SubtitleTrack = SubtitleDiscoveryResponse["tracks"][number];
export type PreparationFeedback = {
	status: "preparing" | "failed";
	name: string;
	errorCode?: string;
} | null;

/** Empty local tracks expose CC choices without making preparation requests. */
export class SubtitleController {
	private readonly registered = new Map<string, TextTrack>();
	private readonly descriptors = new Map<string, SubtitleTrack>();
	private readonly ready = new Set<string>();
	private request: AbortController | null = null;
	private selectedId: string | null = null;
	private replacing = false;
	private disposed = false;
	private readonly tracks: TextTrackList;
	private readonly prepare: (
		trackId: string,
		signal: AbortSignal,
		subtitleVersion: string,
	) => Promise<SubtitlePreparationResponse>;
	private readonly feedback: (value: PreparationFeedback) => void;
	constructor(
		tracks: TextTrackList,
		descriptors: SubtitleTrack[],
		prepare: (
			trackId: string,
			signal: AbortSignal,
			subtitleVersion: string,
		) => Promise<SubtitlePreparationResponse>,
		feedback: (value: PreparationFeedback) => void,
	) {
		this.tracks = tracks;
		this.prepare = prepare;
		this.feedback = feedback;
		for (const descriptor of descriptors) {
			if (!descriptor.supported || !descriptor.format) continue;
			const track = new TextTrack({
				id: descriptor.id,
				label: `${descriptor.name}${descriptor.language ? ` · ${descriptor.language}` : ""} · ${descriptor.format.toUpperCase()}`,
				language: descriptor.language ?? "",
				kind: "subtitles",
				type: "json",
				content: { cues: [] },
			});
			this.descriptors.set(track.id, descriptor);
			this.registered.set(track.id, track);
			tracks.add(track);
		}
		tracks.addEventListener("mode-change", this.changed);
	}
	private changed = () => {
		if (this.replacing || this.disposed) return;
		const selected = this.tracks.selected;
		const id =
			selected && this.descriptors.has(selected.id) ? selected.id : null;
		if (id === this.selectedId) return;
		this.selectedId = id;
		this.request?.abort();
		this.request = null;
		this.feedback(null);
		if (id && !this.ready.has(id)) void this.start(id);
	};
	private async start(id: string) {
		const descriptor = this.descriptors.get(id);
		if (!descriptor) return;
		this.request?.abort();
		const request = new AbortController();
		this.request = request;
		this.feedback({ status: "preparing", name: descriptor.name });
		try {
			const result = await this.prepare(
				id,
				request.signal,
				descriptor.sourceVersion,
			);
			if (request.signal.aborted || this.disposed || this.selectedId !== id)
				return;
			if (result.status !== "ready" || !result.contentUrl)
				throw new Error("SUBTITLE_EXTRACTION_FAILED");
			const old = this.registered.get(id);
			const track = new TextTrack({
				id,
				label: old?.label ?? descriptor.name,
				language: descriptor.language ?? "",
				kind: "subtitles",
				type: result.format,
				src: result.contentUrl,
			});
			this.replacing = true;
			try {
				if (old) this.tracks.remove(old);
				this.registered.set(id, track);
				this.ready.add(id);
				this.tracks.add(track);
				track.mode = "showing";
			} finally {
				this.replacing = false;
			}
			this.feedback(null);
		} catch (error) {
			if (request.signal.aborted || this.disposed || this.selectedId !== id)
				return;
			const code =
				error instanceof Error &&
				"code" in error &&
				typeof error.code === "string"
					? error.code
					: error instanceof Error
						? error.message
						: "SUBTITLE_EXTRACTION_FAILED";
			this.feedback({
				status: "failed",
				name: descriptor.name,
				errorCode: code,
			});
		}
	}
	retry() {
		if (this.selectedId && !this.ready.has(this.selectedId))
			void this.start(this.selectedId);
	}
	dispose() {
		this.disposed = true;
		this.request?.abort();
		this.tracks.removeEventListener("mode-change", this.changed);
		for (const track of this.registered.values()) this.tracks.remove(track);
	}
}
