import type {
	PlaybackOptionsRequest,
	PlaybackOptionsResponse,
	PlaybackSelectionRequest,
} from "../../contracts/http.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { CheckedCompatibility } from "../media-planning/public.js";
export interface PlaybackSelection {
	sourceVersion: string;
	compatibility: DeepReadonly<CheckedCompatibility> | null;
	pending: boolean;
	choice:
		| { kind: "direct"; fileId: string; mimeType: string }
		| { kind: "prepared"; artifactId: string; mimeType: string }
		| { kind: "blocked"; reason: string };
}
export interface PlaybackSelectionApi {
	inspect(input: PlaybackOptionsRequest): Promise<PlaybackOptionsResponse>;
	select(input: PlaybackSelectionRequest): Promise<PlaybackSelection>;
}
