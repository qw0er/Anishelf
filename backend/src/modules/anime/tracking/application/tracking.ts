import type { TrackingListSnapshot } from "../domain/list.js";
import type { TrackingPreview, TrackingStatus } from "../domain/model.js";
import type {
	TrackingOperationCommand,
	TrackingUpdate,
} from "../domain/operation.js";
import type { TrackingApi } from "../public.js";
import type { TrackingAccountApplication } from "./account.js";
import type { TrackingListReader } from "./list-cache.js";
import type { TrackingUpdates } from "./updates.js";
/** Module boundary: account commands and list reads expose no internal credential access. */
export class TrackingModule implements TrackingApi {
	constructor(
		private readonly accounts: TrackingAccountApplication,
		private readonly lists: TrackingListReader,
		private readonly updates: TrackingUpdates,
	) {}
	status(): TrackingStatus {
		return this.accounts.status();
	}
	preview(sessionId: string, credential: string): Promise<TrackingPreview> {
		return this.accounts.preview(sessionId, credential);
	}
	async confirm(
		sessionId: string,
		candidateId: string,
		generation: string,
	): Promise<TrackingStatus> {
		const status = await this.accounts.confirm(
			sessionId,
			candidateId,
			generation,
		);
		this.updates.connectionChanged();
		return status;
	}
	async disconnect(generation: string): Promise<TrackingStatus> {
		const status = await this.accounts.disconnect(generation);
		this.updates.connectionChanged();
		return status;
	}
	async check(): Promise<TrackingStatus> {
		try {
			return await this.accounts.check();
		} finally {
			this.updates.connectionChanged();
		}
	}
	list(generation?: string, refreshStale = true): TrackingListSnapshot {
		return this.lists.read(generation, refreshStale);
	}
	refreshList(generation?: string): Promise<TrackingListSnapshot> {
		return this.lists.refresh(generation);
	}
	operations(generation: string) {
		return this.updates.operations(generation);
	}
	replayCommand(commandId: string, generation: string) {
		return this.updates.replayCommand(commandId, generation);
	}
	manualVersion(mediaId: string, generation: string) {
		return this.updates.manualVersion(mediaId, generation);
	}
	update(mediaId: string, input: TrackingUpdate) {
		return this.updates.update(mediaId, input);
	}
	retryOperation(id: string, input: TrackingOperationCommand) {
		return this.updates.retryOperation(id, input);
	}
	resolveOperation(
		id: string,
		input: TrackingOperationCommand,
		keepRemote: boolean,
	) {
		return this.updates.resolveOperation(id, input, keepRemote);
	}
	async close(): Promise<void> {
		await this.updates.close();
		await this.lists.close();
		await this.accounts.close();
	}
}
