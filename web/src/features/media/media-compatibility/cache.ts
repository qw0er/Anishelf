import { del, get, set } from "idb-keyval";
import { LRUCache } from "lru-cache";
import type { CompatibilityResult } from "../../../shared/api/contracts.js";

/** Only display results are persisted. Playback still validates current source/description evidence. */
export class CompatibilityCache {
	private readonly entries = new LRUCache<string, CompatibilityResult>({
		max: 1000,
		maxSize: 8 * 1024 * 1024,
		sizeCalculation: (value, key) =>
			new TextEncoder().encode(key + JSON.stringify(value)).byteLength,
	});
	private generation = 0;
	private readonly ready: Promise<void>;
	private writes: Promise<void> = Promise.resolve();
	private readonly storage: {
		read(): Promise<unknown>;
		write(
			value: ReturnType<LRUCache<string, CompatibilityResult>["dump"]>,
		): Promise<unknown>;
		clear(): Promise<unknown>;
	};
	constructor(storage: {
		read(): Promise<unknown>;
		write(
			value: ReturnType<LRUCache<string, CompatibilityResult>["dump"]>,
		): Promise<unknown>;
		clear(): Promise<unknown>;
	}) {
		this.storage = storage;
		const generation = this.generation;
		this.ready = storage
			.read()
			.then((value) => {
				if (generation === this.generation && Array.isArray(value))
					this.entries.load(value);
			})
			.catch(() => {});
	}
	async read(fileId: string, version: string) {
		await this.ready;
		const value = this.entries.get(fileId);
		return value?.sourceVersion === version ? structuredClone(value) : null;
	}
	async save(value: CompatibilityResult) {
		await this.ready;
		if (value.direct.status === "unknown") return;
		this.entries.set(value.fileId, structuredClone(value));
		await this.persist();
	}
	async remove(fileId: string) {
		await this.ready;
		this.entries.delete(fileId);
		await this.persist();
	}
	clear() {
		this.generation++;
		this.entries.clear();
		this.writes = this.writes
			.catch(() => {})
			.then(() => this.storage.clear())
			.then(() => {})
			.catch(() => {});
		return this.writes;
	}
	private persist() {
		const values = this.entries.dump();
		this.writes = this.writes
			.catch(() => {})
			.then(() => this.storage.write(values))
			.then(() => {})
			.catch(() => {});
		return this.writes;
	}
}
const storageKey = "anishelf:compatibility";
const environment = () =>
	`compatibility:4:${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}`;
const compatibilityCache = new CompatibilityCache({
	read: async () => {
		const value = await get<{ environment: string; entries: unknown }>(
			storageKey,
		);
		return value?.environment === environment() ? value.entries : [];
	},
	write: (entries) => set(storageKey, { environment: environment(), entries }),
	clear: () => del(storageKey),
});
export const readCompatibility = (fileId: string, version: string) =>
	compatibilityCache.read(fileId, version);
export const saveCompatibility = (value: CompatibilityResult) =>
	compatibilityCache.save(value);
export const removeCompatibility = (fileId: string) =>
	compatibilityCache.remove(fileId);
export const clearCompatibilityCache = () => compatibilityCache.clear();
