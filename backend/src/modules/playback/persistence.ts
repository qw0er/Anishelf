import type { Store } from "../../platform/database/store.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { SourceRegistry } from "../resources/public.js";
import { PlaybackRepository } from "./progress/infrastructure/repository.js";
import {
	type PlaybackPolicy,
	playbackPolicy,
	validatePlaybackPolicy,
} from "./progress/policy.js";
import type { PlaybackStore } from "./progress/ports.js";

export {
	playbackCompletions,
	playbackProgress,
} from "./progress/persistence.js";
export interface PlaybackPersistence {
	playback: PlaybackStore;
}
export function createPlaybackPersistence(
	store: Store,
	sources: SourceRegistry,
	policy: DeepReadonly<PlaybackPolicy> = playbackPolicy,
): PlaybackPersistence {
	validatePlaybackPolicy(policy);
	return { playback: new PlaybackRepository(store, sources, policy) };
}

export * from "./progress/infrastructure/schema.js";
