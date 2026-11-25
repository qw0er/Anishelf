import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { AnimeApi, ReleaseAssessmentApi } from "../../../anime/public.js";
import type { AcquisitionResources } from "../../../resources/public.js";
import type { ManifestPreview } from "../../manifest-preview.js";
import type { ReleaseEvidence, SourcesApi } from "../../sources/public.js";
import type {
	AcquisitionProfile,
	Candidate,
	Subscription,
	SubscriptionAuthorization,
} from "../../subscriptions/public.js";
import type { TorrentConnection } from "../../torrent-clients/public.js";
import { downloadDefaults as policy } from "../defaults.js";
import type { DownloadIntent, VerifiedDownloadFiles } from "../domain/model.js";
import type { DownloadStore, TorrentReader } from "../ports.js";

export function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Acquisition settings or scope changed. Refresh and retry.",
	);
}
export interface DownloadOptions extends TorrentConnection {
	store: Pick<
		DownloadStore,
		"intent" | "saveIntent" | "hashOwner" | "transaction"
	>;
	transport: TorrentReader;
	logger: Logger;
	now?: () => number;
	onAcceptedTarget?(item: DownloadIntent, previous: DownloadIntent): void;
}
/** Read-only subscription capabilities; task failures remain owned by Downloads. */
interface DownloadSelection {
	subscription(workKey: string): Subscription | null;
	subscriptions(): Subscription[];
	candidates(workKey: string): Candidate[];
	release(
		feedId: string,
		entryId: string,
	): Pick<ReleaseEvidence, "download" | "hash"> | null;
	authorization(workKey: string): SubscriptionAuthorization | null;
}

export interface DownloadApplicationOptions extends DownloadOptions {
	initializeBundled?: () => Promise<boolean>;
	store: DownloadStore;
	selection: DownloadSelection;
	sources: SourcesApi;
	profiles?: readonly AcquisitionProfile[];
	defaultProfileId?: () => string | undefined;
	resources: AcquisitionResources;
	anime: ReleaseAssessmentApi;
	manifestPreview?: Pick<ManifestPreview, "preview">;
	ingestion: NonNullable<AnimeApi["ingestion"]>;
}
export type DownloadApplicationContext =
	DownloadContext<DownloadApplicationOptions>;

/** Shared lifetime and the only revision-checked intent writer. */
export class DownloadContext<T extends DownloadOptions = DownloadOptions> {
	readonly planningErrors = new Map<string, string>();
	readonly shutdown = new AbortController();
	readonly pending = new Set<Promise<unknown>>();
	constructor(readonly options: T) {}
	get signal(): AbortSignal {
		return this.shutdown.signal;
	}
	now() {
		return this.options.now?.() ?? Date.now();
	}
	open() {
		if (this.shutdown.signal.aborted)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Acquisition is stopping.",
			);
	}
	tracked<T>(operation: () => Promise<T>) {
		this.open();
		const task = operation();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	save(item: DownloadIntent, files?: VerifiedDownloadFiles) {
		this.open();
		return this.options.store.transaction(() => {
			const current = this.options.store.intent(item.id);
			if (!current || current.revision !== item.revision) conflict();
			if (
				!files &&
				JSON.stringify({ ...current, revision: "", updatedAt: 0 }) ===
					JSON.stringify({ ...item, revision: "", updatedAt: 0 })
			)
				return current;
			const value = { ...item, revision: randomUUID(), updatedAt: this.now() };
			if (!this.options.store.saveIntent(value, files)) conflict();
			if (
				JSON.stringify(value.acceptedTarget) !==
				JSON.stringify(current.acceptedTarget)
			)
				this.options.onAcceptedTarget?.(value, current);
			const saved = this.options.store.intent(value.id);
			if (!saved) conflict();
			if (
				current.state !== item.state ||
				current.ingestion !== item.ingestion ||
				current.error !== item.error
			)
				this.options.logger.info(
					{
						event: "acquisition.intent_state",
						intentId: item.id,
						workKey: item.workKey,
						revision: saved.revision,
						transferId: saved.transferId,
						ownerKey: saved.ownerKey,
						state: item.state,
						ingestion: item.ingestion,
						code: item.error,
					},
					"Acquisition state updated.",
				);
			return saved;
		});
	}
	delay(attempts: number) {
		return Math.min(policy.retryMaximumMs, 30_000 * 2 ** Math.min(attempts, 7));
	}
}

/** Retains our last write across stages without adopting concurrent user commands. */
export class DownloadExecution {
	constructor(
		private readonly context: DownloadContext,
		public current: DownloadIntent,
	) {}
	save(value: DownloadIntent, files?: VerifiedDownloadFiles) {
		this.current = this.context.save(value, files);
		return this.current;
	}
}
