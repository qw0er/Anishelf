import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SubtitleAsset } from "./model.js";

/** Only opaque registered IDs and declared formats can address this private store. */
export class SubtitleAssetFiles {
	private readonly directory: string;
	constructor(dataDir: string) {
		this.directory = join(dataDir, "cache", "subtitles");
	}
	private name(asset: SubtitleAsset): string {
		if (
			!/^subtitle_asset_[A-Za-z0-9_-]+$/.test(asset.id) ||
			!["srt", "ass", "webvtt"].includes(asset.format)
		)
			throw new Error("Invalid subtitle asset key.");
		return `${asset.id}.${asset.format}`;
	}
	async initialize(assets: SubtitleAsset[]): Promise<Set<string>> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const directory = await lstat(this.directory);
		if (!directory.isDirectory() || directory.isSymbolicLink())
			throw new Error("Invalid subtitle cache directory.");
		const keep = new Set(
			assets
				.filter((asset) => asset.status === "ready")
				.map((asset) => this.name(asset)),
		);
		for (const entry of await readdir(this.directory)) {
			if (!keep.has(entry))
				await rm(join(this.directory, entry), { force: true, recursive: true });
		}
		const valid = new Set<string>();
		for (const asset of assets.filter((asset) => asset.status === "ready")) {
			try {
				if ((await this.size(asset)) === asset.sizeBytes) valid.add(asset.id);
			} catch {
				/* Reconciliation invalidates missing or replaced files. */
			}
		}
		return valid;
	}
	async size(asset: SubtitleAsset): Promise<number> {
		const stat = await lstat(join(this.directory, this.name(asset)));
		if (!stat.isFile() || stat.isSymbolicLink())
			throw new Error("Invalid subtitle asset file.");
		return stat.size;
	}
	async totalBytes(): Promise<number> {
		let total = 0;
		for (const name of await readdir(this.directory)) {
			const stat = await lstat(join(this.directory, name));
			if (!stat.isFile() || stat.isSymbolicLink())
				throw new Error("Invalid cache entry.");
			total += stat.size;
		}
		return total;
	}

	async publish(asset: SubtitleAsset, text: string): Promise<void> {
		const path = join(this.directory, this.name(asset));
		const temporary = `${path}.pending`;
		try {
			const handle = await open(temporary, "wx", 0o600);
			try {
				await handle.writeFile(text, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	async remove(asset: SubtitleAsset): Promise<void> {
		await rm(join(this.directory, this.name(asset)), { force: true });
	}
	async read(asset: SubtitleAsset, maximumBytes: number): Promise<string> {
		const handle = await open(
			join(this.directory, this.name(asset)),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const stat = await handle.stat();
			if (
				!stat.isFile() ||
				stat.size !== asset.sizeBytes ||
				stat.size > maximumBytes
			)
				throw new Error("Invalid subtitle asset.");
			const bytes = Buffer.alloc(stat.size + 1);
			let size = 0;
			while (size < bytes.length) {
				const result = await handle.read(
					bytes,
					size,
					bytes.length - size,
					null,
				);
				if (!result.bytesRead) break;
				size += result.bytesRead;
			}
			if (size !== stat.size) throw new Error("Subtitle asset changed.");
			return new TextDecoder("utf-8", { fatal: true }).decode(
				bytes.subarray(0, size),
			);
		} finally {
			await handle.close();
		}
	}
}
