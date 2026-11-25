import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	lt,
	lte,
	ne,
	notInArray,
	sql,
} from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import {
	type DownloadDestination,
	type DownloadIntent,
	isCanonicalDownloadHash,
	keepsEpisodeClaim,
	type VerifiedDownloadFiles,
} from "../domain/model.js";
import type { DownloadStore } from "../ports.js";
import { FileSelectionRecords } from "./file-selection.js";
import {
	readAcquisitionDestination,
	readDownloadRequest,
	writeAcquisitionDestination,
	writeDownloadRequest,
} from "./records.js";
import {
	acquisitionEpisodeClaims as claims,
	acquisitionRequestCommands as commands,
	acquisitionDestination as destination,
	acquisitionDirectories as directories,
	acquisitionRequests as requests,
	acquisitionTransfers as transfers,
} from "./schema.js";

const terminalStates: DownloadIntent["state"][] = [
	"available",
	"missing",
	"blocked",
];

export class DownloadRepository implements DownloadStore {
	readonly fileSelection: DownloadStore["fileSelection"];
	readonly ownedFileSelection: DownloadStore["ownedFileSelection"];
	readonly episodeFileSelection: DownloadStore["episodeFileSelection"];
	readonly planFileSelection: DownloadStore["planFileSelection"];
	readonly updateFileSelection: DownloadStore["updateFileSelection"];
	constructor(private readonly store: Store) {
		const selections = new FileSelectionRecords(store);
		this.fileSelection = selections.fileSelection.bind(selections);
		this.ownedFileSelection = selections.ownedFileSelection.bind(selections);
		this.episodeFileSelection =
			selections.episodeFileSelection.bind(selections);
		this.planFileSelection = selections.planFileSelection.bind(selections);
		this.updateFileSelection = selections.updateFileSelection.bind(selections);
	}
	transaction<T>(operation: () => T): T {
		return this.store.transaction(() => operation(), { behavior: "immediate" });
	}
	destination() {
		const row = this.store.select().from(destination).get();
		if (!row) return null;
		const { id: _id, ...value } = readAcquisitionDestination(this.store, row);
		return value;
	}
	saveDestination(data: DownloadDestination) {
		writeAcquisitionDestination(this.store, { ...data, id: "default" });
	}
	directory(workKey: string) {
		return (
			this.store
				.select()
				.from(directories)
				.where(eq(directories.workKey, workKey))
				.get()?.directory ?? null
		);
	}
	saveDirectory(workKey: string, directory: string) {
		this.store
			.insert(directories)
			.values({ workKey, directory })
			.onConflictDoNothing()
			.run();
	}

	summary(workKey: string) {
		const summary = this.store
			.select({
				total: sql<number>`count(*)`,
				active: sql<number>`coalesce(sum(${requests.state} not in ('available', 'missing', 'blocked')), 0)`,
				attention: sql<number>`coalesce(sum(${requests.error} is not null), 0)`,
			})
			.from(claims)
			.innerJoin(requests, eq(claims.requestId, requests.id))
			.where(eq(claims.workKey, workKey))
			.get();
		return summary ?? { total: 0, active: 0, attention: 0 };
	}

	activity(workKey: string, page: number, pageSize: number) {
		const summary = this.summary(workKey);
		const items = this.project(this.store)
			.where(eq(claims.workKey, workKey))
			.orderBy(
				sql`case when ${requests.error} is not null then 0 when ${requests.state} not in ('available', 'missing', 'blocked') then 1 else 2 end`,
				desc(requests.createdAt),
				asc(requests.id),
			)
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.all()
			.map(readDownloadRequest);
		const candidateIds = this.store
			.select({ id: requests.candidateId })
			.from(claims)
			.innerJoin(requests, eq(claims.requestId, requests.id))
			.where(eq(claims.workKey, workKey))
			.all()
			.map((row) => row.id);
		return { items, ...summary, candidateIds };
	}
	lockedCandidates(workKey: string) {
		return this.store
			.select({ id: requests.candidateId })
			.from(claims)
			.innerJoin(requests, eq(claims.requestId, requests.id))
			.where(and(eq(claims.workKey, workKey), eq(claims.live, true)))
			.orderBy(asc(requests.candidateId))
			.all()
			.map((row) => row.id);
	}
	attemptedCandidate(workKey: string, candidateId: string) {
		return Boolean(
			this.store
				.select({ id: requests.id })
				.from(claims)
				.innerJoin(requests, eq(claims.requestId, requests.id))
				.where(
					and(
						eq(claims.workKey, workKey),
						eq(requests.candidateId, candidateId),
					),
				)
				.limit(1)
				.get(),
		);
	}
	episodeIntent(workKey: string, episode: number) {
		const row = this.project(this.store)
			.where(
				and(
					eq(claims.workKey, workKey),
					eq(claims.episode, episode),
					eq(claims.live, true),
				),
			)
			.get();
		return row ? readDownloadRequest(row) : null;
	}
	reservedEpisode(workKey: string, episode: number) {
		return Boolean(
			this.store
				.select({ id: claims.id })
				.from(claims)
				.where(
					and(
						eq(claims.workKey, workKey),
						eq(claims.episode, episode),
						eq(claims.live, true),
					),
				)
				.get(),
		);
	}
	episodeCommand(commandId: string) {
		const row = this.project(this.store)
			.innerJoin(commands, eq(commands.requestId, requests.id))
			.where(eq(commands.id, commandId))
			.get();
		return row ? readDownloadRequest(row) : null;
	}
	saveEpisodeCommand(commandId: string, requestId: string) {
		this.store.insert(commands).values({ id: commandId, requestId }).run();
	}
	hashOwner(hash: string, generation: string, exceptId: string) {
		return this.hasOtherTransfer(this.store, hash, generation, exceptId);
	}
	workBatch(afterId: string, limit: number, now: number) {
		return this.project(this.store)
			.where(
				and(
					gt(requests.id, afterId),
					notInArray(requests.state, terminalStates),
					lte(requests.nextAttemptAt, now),
				),
			)
			.orderBy(asc(requests.id))
			.limit(limit)
			.all()
			.map(readDownloadRequest);
	}
	hasActive() {
		return Boolean(
			this.store
				.select({ id: requests.id })
				.from(requests)
				.where(notInArray(requests.state, terminalStates))
				.limit(1)
				.get(),
		);
	}

	intent(id: string) {
		const row = this.project(this.store).where(eq(requests.id, id)).get();
		return row ? readDownloadRequest(row) : null;
	}
	reserve(data: DownloadIntent) {
		return this.store.transaction(
			(store) => {
				if (
					store
						.select({ id: requests.id })
						.from(requests)
						.where(eq(requests.id, data.id))
						.get() ||
					!this.canWrite(store, data)
				)
					return false;
				writeDownloadRequest(store, data, null);
				return true;
			},
			{ behavior: "immediate" },
		);
	}
	saveIntent(data: DownloadIntent, files?: VerifiedDownloadFiles) {
		return this.store.transaction(
			(store) => {
				const current = this.project(store)
					.where(eq(requests.id, data.id))
					.get();
				if (
					!current ||
					current.claim.workKey !== data.workKey ||
					current.claim.episode !== data.episode ||
					!this.canWrite(
						store,
						data,
						current.transfer?.selectionMode === "files"
							? current.transfer.id
							: undefined,
					)
				)
					return false;
				writeDownloadRequest(store, data, current.transfer, files);
				return true;
			},
			{ behavior: "immediate" },
		);
	}
	prune(before: number, onPruned?: (item: DownloadIntent) => void) {
		this.store.transaction(
			(store) => {
				const expired = and(
					lt(requests.updatedAt, before),
					inArray(requests.state, ["available", "missing"]),
					ne(requests.source, ""),
				);
				const items = this.project(store).where(expired).all();
				for (const row of items) onPruned?.(readDownloadRequest(row));
				store
					.update(requests)
					.set({ source: "", title: "", error: null })
					.where(expired)
					.run();
			},
			{ behavior: "immediate" },
		);
	}

	private project(store: Store) {
		return store
			.select({ request: requests, claim: claims, transfer: transfers })
			.from(requests)
			.innerJoin(claims, eq(claims.requestId, requests.id))
			.leftJoin(transfers, eq(claims.transferId, transfers.id));
	}
	private canWrite(
		store: Store,
		value: DownloadIntent,
		sharedTransferId?: string,
	) {
		const live = keepsEpisodeClaim(value);
		if (
			live &&
			store
				.select({ id: claims.id })
				.from(claims)
				.where(
					and(
						eq(claims.workKey, value.workKey),
						eq(claims.episode, value.episode),
						eq(claims.live, true),
						ne(claims.id, value.id),
					),
				)
				.get()
		)
			return false;
		return (
			(!live && value.state !== "available") ||
			!this.hasOtherTransfer(
				store,
				value.hash,
				value.destination.connectionGeneration,
				value.id,
				sharedTransferId,
			)
		);
	}
	private hasOtherTransfer(
		store: Store,
		hash: string,
		generation: string,
		exceptId: string,
		sharedTransferId?: string,
	) {
		if (!isCanonicalDownloadHash(hash)) return false;
		return Boolean(
			store
				.select({ id: transfers.id })
				.from(transfers)
				.where(
					and(
						eq(transfers.hash, hash),
						eq(transfers.destinationConnectionGeneration, generation),
						eq(transfers.owned, true),
						ne(transfers.requestId, exceptId),
						sharedTransferId ? ne(transfers.id, sharedTransferId) : undefined,
					),
				)
				.get(),
		);
	}
}
