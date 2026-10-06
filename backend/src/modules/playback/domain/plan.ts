import type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

export type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

import type {
	HlsPlaybackResource,
	PlaybackPlanDto,
	PlaybackResource,
} from "../../../contracts/http.js";

/** Public decisions contain resource references, never paths or encoder settings. */
export type PlaybackPlan = PlaybackPlanDto;

/** Preparation owns publication/deletion; playback only borrows ready artifacts. */
export interface PreparedPlaybackResource {
	artifactId: string;
	identity: DerivedMediaIdentity;
	resource: PlaybackResource;
}

/** The real-time owner controls children/segments; this generation is not history's generation. */
export interface RealtimePlaybackResource {
	sessionId: string;
	identity: DerivedMediaIdentity;
	resource: HlsPlaybackResource;
	streamGeneration: number;
}
