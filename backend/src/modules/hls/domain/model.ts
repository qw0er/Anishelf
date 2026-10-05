import type {
	HlsPlaybackResource,
	MediaTimeline,
	MediaTrack,
} from "../../../contracts/http.js";
import type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

/** Private resource metadata. Filesystem locations never enter HTTP contracts. */
interface HlsResourceMetadata {
	id: string;
	identity: DerivedMediaIdentity;
	streamGeneration: number;
	timeline: MediaTimeline;
	tracks: MediaTrack[];
	sizeBytes: number;
}
export type HlsResource = HlsResourceMetadata &
	(
		| {
				owner: { kind: "prepared"; artifactId: string };
				completeness: "complete";
		  }
		| {
				owner: { kind: "realtime"; sessionId: string };
				completeness: "complete" | "growing";
		  }
	);
/** Only completed, validated segments may be referenced by a public playlist. */
export interface HlsSegment {
	trackId: string;
	sequence: number;
	streamGeneration: number;
	sourceStartMs: number;
	durationMs: number;
	sizeBytes: number;
	publication: "pending" | "published";
}
/** Resource owners acquire leases; HTTP reads do not create processing work. */
export interface HlsApi {
	getResource(
		id: string,
		streamGeneration: number,
	): Promise<HlsPlaybackResource>;
	acquire(id: string, borrowerId: string): Promise<void>;
	release(id: string, borrowerId: string): Promise<void>;
}
