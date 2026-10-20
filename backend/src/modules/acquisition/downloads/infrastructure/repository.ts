import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type {
	DownloadAuthorization,
	DownloadDestination,
	DownloadIntent,
} from "../domain/model.js";
import type { DownloadStore } from "../ports.js";
import {
	acquisitionAuthorizations as authorizations,
	acquisitionDestination as destination,
	acquisitionDirectories as directories,
	acquisitionIntents as intents,
} from "./schema.js";
export class DownloadRepository implements DownloadStore {
	constructor(private readonly store: Store) {}
	destination() {
		return this.store.select().from(destination).get()?.data ?? null;
	}
	saveDestination(data: DownloadDestination) {
		this.store
			.insert(destination)
			.values({ id: "default", data })
			.onConflictDoUpdate({ target: destination.id, set: { data } })
			.run();
	}
	authorization(workKey: string) {
		return (
			this.store
				.select()
				.from(authorizations)
				.where(eq(authorizations.workKey, workKey))
				.get()?.data ?? null
		);
	}
	authorize(data: DownloadAuthorization) {
		this.store
			.insert(authorizations)
			.values({ workKey: data.workKey, data })
			.onConflictDoUpdate({ target: authorizations.workKey, set: { data } })
			.run();
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
				active: sql<number>`coalesce(sum(json_extract(${intents.data}, '$.state') not in ('available', 'missing', 'blocked')), 0)`,
				attention: sql<number>`coalesce(sum(json_extract(${intents.data}, '$.error') is not null), 0)`,
			})
			.from(intents)
			.where(scope)
			.get();
		const items = this.store
			.select()
			.from(intents)
			.where(scope)
			.orderBy(
				desc(sql`json_extract(${intents.data}, '$.createdAt')`),
				asc(intents.id),
			)
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.all()
			.map((row) => row.data);
		const candidateIds = this.store
			.select({
				id: sql<string>`json_extract(${intents.data}, '$.candidateId')`,
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
	reservedEpisode(workKey: string, episode: number) {
		return Boolean(
			this.store
				.select({ id: intents.id })
				.from(intents)
				.where(
					and(
						eq(intents.workKey, workKey),
						eq(intents.episode, String(episode)),
					),
				)
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
					sql`json_extract(${intents.data}, '$.state') not in ('missing', 'blocked')`,
					sql`json_extract(${intents.data}, '$.nextAttemptAt') <= ${now}`,
				),
			)
			.orderBy(asc(intents.id))
			.limit(limit)
			.all()
			.map((row) => row.data);
	}
	hasActive() {
		return Boolean(
			this.store
				.select({ id: intents.id })
				.from(intents)
				.where(
					sql`json_extract(${intents.data}, '$.state') not in ('available', 'missing', 'blocked')`,
				)
				.limit(1)
				.get(),
		);
	}

	intent(id: string) {
		return (
			this.store.select().from(intents).where(eq(intents.id, id)).get()?.data ??
			null
		);
	}
	reserve(data: DownloadIntent) {
		return (
			this.store
				.insert(intents)
				.values({
					id: data.id,
					workKey: data.workKey,
					episode: String(data.episode),
					hash: data.hash,
					data,
				})
				.onConflictDoNothing()
				.run().changes === 1
		);
	}
	saveIntent(data: DownloadIntent) {
		this.store
			.update(intents)
			.set({ data, hash: data.hash })
			.where(eq(intents.id, data.id))
			.run();
	}

	prune(before: number) {
		this.store
			.update(intents)
			.set({
				data: sql`json_set(${intents.data}, '$.source', '', '$.title', '', '$.transfer', null, '$.error', null)`,
			})
			.where(
				and(
					sql`json_extract(${intents.data}, '$.updatedAt') < ${before}`,
					sql`json_extract(${intents.data}, '$.state') in ('available', 'missing')`,
					sql`json_extract(${intents.data}, '$.source') <> ''`,
				),
			)
			.run();
	}
}
