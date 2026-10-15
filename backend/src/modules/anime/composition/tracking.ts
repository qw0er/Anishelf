import type { Logger } from "pino";
import type { AniListClient } from "../anilist/public.js";
import { TrackingApplication } from "../tracking/application.js";
import { TrackingCredentialFiles } from "../tracking/infrastructure/credentials.js";
import type { TrackingStore } from "../tracking/ports.js";
export async function createTrackingModule(options: {
	dataDir: string;
	store: TrackingStore;
	client: AniListClient;
	logger?: Logger;
}) {
	const credentials = new TrackingCredentialFiles(options.dataDir);
	await credentials.initialize(options.store.get()?.credentialId ?? null);
	const tracking = new TrackingApplication({ ...options, credentials });
	await tracking.initialize();
	return tracking;
}
