import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { MediaInfo } from "@anishelf/media-tools";
import type { Logger } from "pino";
import {
	isWindowsSharingError,
	removeFile,
	renameFile,
	syncDirectory,
} from "../../../platform/filesystem.js";
import { storageRules } from "../../../platform/storage.js";
import type { PreparedArtifact } from "../preparation/public.js";
import { InvalidPreparedMediaError } from "./public.js";

/** Private files addressed only by opaque execution fingerprints. */
export class PreparedMediaFiles {
	private readonly root: string;
	constructor(
		dataDir: string,
		private readonly logger?: Logger,
	) {
		this.root = join(dataDir, "cache", "prepared-media");
	}
	path(id: string): string {
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
		for (const name of await readdir(this.root)) {
			if (keep.has(name)) continue;
			try {
				await removeFile(join(this.root, name), {
					force: true,
					recursive: true,
				});
			} catch (err) {
				if (!isWindowsSharingError(err)) throw err;
				this.logger?.warn(
					{ event: "preparation.orphan_cleanup_deferred", name, err },
					"Prepared-media cache entry is still in use.",
				);
			}
		}
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
		// The processor has already synced this private output.
		const handle = await this.openAt(processedPath, sizeBytes);
		await handle.close();
		try {
			await renameFile(processedPath, path);
		} catch (err) {
			this.logger?.warn(
				{ event: "preparation.publish_failed", id, err },
				"Could not move validated media into the prepared cache.",
			);
			throw err;
		}
		await syncDirectory(this.root);
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
	async inspect(
		artifact: PreparedArtifact,
		probe: (path: string) => Promise<MediaInfo>,
	) {
		const handle = await this.open(artifact);
		try {
			return await probe(this.path(artifact.id));
		} finally {
			await handle.close();
		}
	}
	async remove(id: string): Promise<void> {
		await removeFile(this.path(id), { force: true });
	}
}
