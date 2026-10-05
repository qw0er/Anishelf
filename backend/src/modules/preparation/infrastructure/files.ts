import { constants } from "node:fs";
import {
	link,
	lstat,
	mkdir,
	open,
	readdir,
	rename,
	rm,
	statfs,
} from "node:fs/promises";
import { join } from "node:path";
import { storageRules } from "../../../platform/storage.js";
import type { PreparedArtifact } from "../domain/model.js";

/** Private files addressed only by opaque execution fingerprints. */
export class PreparedMediaFiles {
	private readonly root: string;
	constructor(dataDir: string) {
		this.root = join(dataDir, "cache", "prepared-media");
	}
	private path(id: string): string {
		if (!/^[a-f0-9]{64}$/.test(id))
			throw new Error("Invalid prepared artifact identity.");
		return join(this.root, `${id}.media`);
	}
	async initialize(artifacts: PreparedArtifact[]): Promise<Set<string>> {
		await mkdir(this.root, {
			recursive: true,
			mode: storageRules.directoryMode,
		});
		const root = await lstat(this.root);
		if (!root.isDirectory() || root.isSymbolicLink())
			throw new Error("Invalid prepared media directory.");
		const keep = new Set(artifacts.map((artifact) => `${artifact.id}.media`));
		for (const name of await readdir(this.root))
			if (!keep.has(name))
				await rm(join(this.root, name), { force: true, recursive: true });
		const valid = new Set<string>();
		for (const artifact of artifacts) {
			try {
				const handle = await this.open(artifact);
				await handle.close();
				valid.add(artifact.id);
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					) &&
					!(error instanceof InvalidPreparedMediaError)
				)
					throw error;
			}
		}
		return valid;
	}
	async availableBytes(): Promise<number> {
		const stats = await statfs(this.root, { bigint: true });
		const bytes = stats.bavail * stats.bsize;
		return Number(
			bytes > BigInt(Number.MAX_SAFE_INTEGER)
				? BigInt(Number.MAX_SAFE_INTEGER)
				: bytes,
		);
	}
	async publish(
		id: string,
		processedPath: string,
		sizeBytes: number,
	): Promise<void> {
		const path = this.path(id);
		const pending = `${path}.pending`;
		try {
			// Same data directory/filesystem: adopt the validated bytes without copying a film.
			await link(processedPath, pending);
			const handle = await this.openAt(pending, sizeBytes);
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
			await rename(pending, path);
			const directory = await open(this.root, constants.O_RDONLY);
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		} finally {
			await rm(pending, { force: true });
		}
	}
	private async openAt(path: string, sizeBytes: number) {
		const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size !== sizeBytes || stat.size <= 0)
				throw new InvalidPreparedMediaError();
			return handle;
		} catch (error) {
			await handle.close();
			throw error;
		}
	}
	open(artifact: PreparedArtifact) {
		return this.openAt(this.path(artifact.id), artifact.sizeBytes);
	}
	async remove(id: string): Promise<void> {
		await rm(this.path(id), { force: true });
		await rm(`${this.path(id)}.pending`, { force: true });
	}
}
export class InvalidPreparedMediaError extends Error {
	constructor() {
		super("Prepared media is not a valid completed file.");
	}
}
