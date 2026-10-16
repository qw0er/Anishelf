import type { TrackingListSnapshot } from "../domain/list.js";
import type { TrackingPreview, TrackingStatus } from "../domain/model.js";
import type { TrackingApi } from "../public.js";
import type { TrackingAccountApplication } from "./account.js";
import type { TrackingListReader } from "./list-cache.js";
/** Module boundary: account commands and list reads expose no internal credential access. */
export class TrackingModule implements TrackingApi {
	constructor(
		private readonly accounts: TrackingAccountApplication,
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
