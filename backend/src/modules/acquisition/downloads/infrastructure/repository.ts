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
import type { DownloadDestination, DownloadIntent } from "../domain/model.js";
import type { DownloadStore } from "../ports.js";
import {
	readAcquisitionDestination,
	readAcquisitionIntents,
	writeAcquisitionDestination,
	writeAcquisitionIntents,
} from "./records.js";
import {
	acquisitionDestination as destination,
	acquisitionDirectories as directories,
	acquisitionIntents as intents,
} from "./schema.js";
export class DownloadRepository implements DownloadStore {
	constructor(private readonly store: Store) {}
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

	activity(workKey: string, page: number, pageSize: number) {
		const scope = eq(intents.workKey, workKey);
		const summary = this.store
			.select({
				total: sql<number>`count(*)`,
				active: sql<number>`coalesce(sum(${intents.state} not in ('available', 'missing', 'blocked')), 0)`,
				attention: sql<number>`coalesce(sum(${intents.error} is not null), 0)`,
			})
			.from(intents)
			.where(scope)
			.get();
		const items = this.store
			.select()
			.from(intents)
			.where(scope)
			.orderBy(
				sql`case when ${intents.error} is not null then 0 when ${intents.state} not in ('available', 'missing', 'blocked') then 1 else 2 end`,
				desc(intents.createdAt),
				asc(intents.id),
			)
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.all()
			.map((row) => readAcquisitionIntents(this.store, row));
		const candidateIds = this.store
			.select({
				id: intents.candidateId,
			})
			.from(intents)
			.where(scope)
			.all()
			.map((row) => row.id);
		return {
			items,
			total: summary?.total ?? 0,
			active: summary?.active ?? 0,
			attention: summary?.attention ?? 0,
			candidateIds,
		};
	}
	lockedCandidates(workKey: string) {
		return this.store
			.select({ id: intents.candidateId })
			.from(intents)
			.where(eq(intents.workKey, workKey))
			.all()
			.map((row) => row.id);
	}
	reservedEpisode(workKey: string, episode: number) {
		return Boolean(
			this.store
				.select({ id: intents.id })
				.from(intents)
				.where(and(eq(intents.workKey, workKey), eq(intents.episode, episode)))
				.get(),
		);
	}
	hashOwner(hash: string, exceptId: string) {
		return Boolean(
			this.store
				.select({ id: intents.id })
				.from(intents)
				.where(and(eq(intents.hash, hash), ne(intents.id, exceptId)))
				.get(),
		);
	}
	workBatch(afterId: string, limit: number, now: number) {
		return this.store
			.select()
			.from(intents)
			.where(
				and(
					gt(intents.id, afterId),
					notInArray(intents.state, ["available", "missing", "blocked"]),
					lte(intents.nextAttemptAt, now),
				),
			)
			.orderBy(asc(intents.id))
			.limit(limit)
			.all()
			.map((row) => readAcquisitionIntents(this.store, row));
	}
	hasActive() {
		return Boolean(
			this.store
				.select({ id: intents.id })
				.from(intents)
				.where(notInArray(intents.state, ["available", "missing", "blocked"]))
				.limit(1)
				.get(),
		);
	}

	intent(id: string) {
		const row = this.store
			.select()
			.from(intents)
			.where(eq(intents.id, id))
			.get();
		return row ? readAcquisitionIntents(this.store, row) : null;
	}
	reserve(data: DownloadIntent) {
		return this.store.transaction(
			() => {
				if (
					this.intent(data.id) ||
					this.reservedEpisode(data.workKey, data.episode) ||
					this.hashOwner(data.hash, data.id)
				)
					return false;
				writeAcquisitionIntents(this.store, data);
				return true;
			},
			{ behavior: "immediate" },
		);
	}
	saveIntent(data: DownloadIntent) {
		if (this.intent(data.id)) writeAcquisitionIntents(this.store, data);
	}
	prune(before: number) {
		this.store
			.update(intents)
			.set({ source: "", title: "", transfer: null, error: null })
			.where(
				and(
					lt(intents.updatedAt, before),
					inArray(intents.state, ["available", "missing"]),
					ne(intents.source, ""),
				),
			)
			.run();
	}
}
