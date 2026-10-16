import type { Logger } from "pino";
import type { AniListClient } from "../anilist/public.js";
import { TrackingListReader } from "../tracking/application/list-cache.js";
import { TrackingApplication } from "../tracking/application.js";
import type { TrackingListSnapshot } from "../tracking/domain/list.js";
import type {
	TrackingPreview,
	TrackingStatus,
} from "../tracking/domain/model.js";
import { TrackingCredentialFiles } from "../tracking/infrastructure/credentials.js";
import { AniListListProvider } from "../tracking/infrastructure/list-provider.js";
import type { TrackingListStore, TrackingStore } from "../tracking/ports.js";
import type { TrackingApi, TrackingListsApi } from "../tracking/public.js";

export interface TrackingModuleOptions {
	dataDir: string;
	store: TrackingStore;
	listStore: TrackingListStore;
	client: AniListClient;
	logger?: Logger;
}
/** Module boundary: account commands and list reads expose no internal credential access. */
export class TrackingModule implements TrackingApi, TrackingListsApi {
	constructor(
		private readonly accounts: TrackingApplication,
		private readonly lists: TrackingListReader,
	) {}
	status(): TrackingStatus {
		return this.accounts.status();
	}
	preview(sessionId: string, token: string): Promise<TrackingPreview> {
		return this.accounts.preview(sessionId, token);
	}
	confirm(
		sessionId: string,
		candidateId: string,
		generation: string,
	): Promise<TrackingStatus> {
		return this.accounts.confirm(sessionId, candidateId, generation);
	}
	disconnect(generation: string): Promise<TrackingStatus> {
		return this.accounts.disconnect(generation);
	}
	check(): Promise<TrackingStatus> {
		return this.accounts.check();
	}
	list(generation?: string, refreshStale = true): TrackingListSnapshot {
		return this.lists.read(generation, refreshStale);
	}
	refreshList(generation?: string): Promise<TrackingListSnapshot> {
		return this.lists.refresh(generation);
	}
	async close(): Promise<void> {
		await this.lists.close();
		await this.accounts.close();
	}
}
export async function createTrackingModule(
	options: TrackingModuleOptions,
): Promise<TrackingModule> {
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
	return new TrackingModule(tracking, lists);
}
