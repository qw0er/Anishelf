import { type DeepReadonly, freeze } from "../shared/policy.js";

export type { DeepReadonly } from "../shared/policy.js";

import {
	type MediaInspectionPolicy,
	type MediaProcessingPolicy,
	mediaInspectionPolicy,
	mediaProcessingPolicy,
	type PreparationPolicy,
	preparationPolicy,
	type SubtitlePolicy,
	subtitlePolicy,
	validateMediaInspectionPolicy,
	validateMediaProcessingPolicy,
	validatePreparationPolicy,
	validateSubtitlePolicy,
} from "../modules/media/create.js";
import {
	type PlaybackPolicy,
	playbackPolicy,
	validatePlaybackPolicy,
} from "../modules/playback/create.js";
import {
	type LibraryPolicy,
	libraryPolicy,
	type ResourceAccessPolicy,
	resourceAccessPolicy,
	validateLibraryPolicy,
	validateResourceAccessPolicy,
} from "../modules/resources/create.js";
import {
	type DatabasePolicy,
	databasePolicy,
	validateDatabasePolicy,
} from "../platform/database-policy.js";
import {
	type MediaToolPolicy,
	mediaToolPolicy,
	validateMediaToolPolicy,
} from "../platform/media/policy.js";
import {
	type RuntimePolicy,
	runtimePolicy,
	validateRuntimePolicy,
} from "../platform/runtime-policy.js";
import {
	type HttpPolicy,
	httpPolicy,
	validateHttpPolicy,
} from "../transport/policy.js";

/** Composition only: module owners define defaults, types and validation. */
export interface BuiltinPolicy {
	library: LibraryPolicy;
	playback: PlaybackPolicy;
	subtitles: SubtitlePolicy;
	resourceAccess: ResourceAccessPolicy;
	mediaInspection: MediaInspectionPolicy;
	mediaProcessing: MediaProcessingPolicy;
	preparation: PreparationPolicy;
	mediaTools: MediaToolPolicy;
	http: HttpPolicy;
	database: DatabasePolicy;
	runtime: RuntimePolicy;
}
export const builtinPolicy: DeepReadonly<BuiltinPolicy> = freeze({
	library: libraryPolicy,
	playback: playbackPolicy,
	subtitles: subtitlePolicy,
	resourceAccess: resourceAccessPolicy,
	mediaInspection: mediaInspectionPolicy,
	mediaProcessing: mediaProcessingPolicy,
	preparation: preparationPolicy,
	mediaTools: mediaToolPolicy,
	http: httpPolicy,
	database: databasePolicy,
	runtime: runtimePolicy,
});
export function validatePolicy(policy: DeepReadonly<BuiltinPolicy>): void {
	validateLibraryPolicy(policy.library);
	validatePlaybackPolicy(policy.playback);
	validateSubtitlePolicy(policy.subtitles);
	validateResourceAccessPolicy(policy.resourceAccess);
	validateMediaInspectionPolicy(policy.mediaInspection);
	validateMediaProcessingPolicy(policy.mediaProcessing);
	validatePreparationPolicy(policy.preparation);
	validateMediaToolPolicy(policy.mediaTools);
	validateHttpPolicy(policy.http);
	validateDatabasePolicy(policy.database);
	validateRuntimePolicy(policy.runtime);
}
