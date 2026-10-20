import { eq } from "drizzle-orm";
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
	intents() {
		return this.store
			.select()
			.from(intents)
			.all()
			.map((row) => row.data);
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
		for (const item of this.intents())
			if (
				item.updatedAt < before &&
				["available", "missing"].includes(item.state) &&
				item.source
			) {
				// Keep reservations, suppression and source identity after detailed evidence expires.
				this.saveIntent({
					...item,
					source: "",
					title: "",
					transfer: null,
					error: null,
				});
			}
	}
}
