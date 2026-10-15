import type { Logger } from "pino";
import type { AniListClient } from "../anilist/public.js";
import { TrackingListReader } from "../tracking/application/list-cache.js";
import { TrackingApplication } from "../tracking/application.js";
import { TrackingCredentialFiles } from "../tracking/infrastructure/credentials.js";
import { AniListListProvider } from "../tracking/infrastructure/list-provider.js";
import type { TrackingListStore, TrackingStore } from "../tracking/ports.js";
export async function createTrackingModule(options: {
	dataDir: string;
	store: TrackingStore;
	listStore: TrackingListStore;
	client: AniListClient;
	logger?: Logger;
}) {
	const credentials = new TrackingCredentialFiles(options.dataDir);
	await credentials.initialize(options.store.get()?.credentialId ?? null);
	const tracking = new TrackingApplication({ ...options, credentials });
	await tracking.initialize();
	const lists = new TrackingListReader({
		access: tracking,
		store: options.listStore,
		provider: new AniListListProvider(options.client),
		...(options.logger ? { logger: options.logger } : {}),
	});
	return {
		status: tracking.status.bind(tracking),
		preview: tracking.preview.bind(tracking),
		confirm: tracking.confirm.bind(tracking),
		disconnect: tracking.disconnect.bind(tracking),
		check: tracking.check.bind(tracking),
		list: (generation?: string, refreshStale = true) => {
			return lists.read(generation, refreshStale);
		},
		refreshList: async (generation?: string) => {
			return lists.refresh(generation);
		},
		close: async () => {
			await lists.close();
			await tracking.close();
		},
	};
}
