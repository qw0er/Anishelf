import type { TrackingStatus } from "../domain/model.js";
import type { TrackingApi } from "../public.js";
import type { TrackingAccountApplication } from "./account.js";
import type { TrackingListReader } from "./list-cache.js";
import type { TrackingUpdates } from "./updates.js";
/** Module boundary: account commands and list reads expose no internal credential access. */
export class TrackingModule implements TrackingApi {
	readonly status: TrackingApi["status"];
	readonly preview: TrackingApi["preview"];
	readonly list: TrackingApi["list"];
	readonly refreshList: TrackingApi["refreshList"];
	readonly acquisitionSnapshot: TrackingListReader["acquisitionSnapshot"];
	readonly operations: TrackingApi["operations"];
	readonly replayCommand: TrackingApi["replayCommand"];
	readonly manualVersion: TrackingApi["manualVersion"];
	readonly update: TrackingApi["update"];
	readonly retryOperation: TrackingApi["retryOperation"];
	readonly resolveOperation: TrackingApi["resolveOperation"];
	constructor(
		private readonly accounts: TrackingAccountApplication,
		private readonly lists: TrackingListReader,
		private readonly updates: TrackingUpdates,
	) {
		this.status = accounts.status;
		this.preview = accounts.preview.bind(accounts);
		this.list = lists.read.bind(lists);
		this.refreshList = lists.refresh.bind(lists);
		this.acquisitionSnapshot = lists.acquisitionSnapshot.bind(lists);
		this.operations = updates.operations.bind(updates);
		this.replayCommand = updates.replayCommand.bind(updates);
		this.manualVersion = updates.manualVersion.bind(updates);
		this.update = updates.update.bind(updates);
		this.retryOperation = updates.retryOperation.bind(updates);
		this.resolveOperation = updates.resolveOperation.bind(updates);
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
	async close(): Promise<void> {
		await this.updates.close();
		await this.lists.close();
		await this.accounts.close();
	}
}
