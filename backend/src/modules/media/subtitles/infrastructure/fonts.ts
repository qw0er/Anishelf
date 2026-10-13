import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { create } from "fontkit";
import type { SubtitleFontAsset } from "../domain/model.js";

export function fontDigest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
export function validateFont(
	bytes: Buffer,
): Pick<SubtitleFontAsset, "format" | "family"> {
	const signature = bytes.subarray(0, 4).toString("hex");
	if (signature !== "00010000" && signature !== "4f54544f")
		throw new Error("Unsupported font payload.");
	const font = create(bytes);
	if (!("familyName" in font) || !font.familyName || !font.numGlyphs)
		throw new Error("Invalid font payload.");
	// Decode the naming and character map tables, rather than trusting an extension or MIME tag.
	if (!font.characterSet.length) throw new Error("Empty font character map.");
	return {
		format: signature === "4f54544f" ? "otf" : "ttf",
		family: font.familyName,
	};
}
export class SubtitleFontFiles {
	private readonly directory: string;
	constructor(dataDir: string) {
		this.directory = join(dataDir, "subtitle-fonts");
	}
	private path(id: string): string {
		if (!/^font_[A-Za-z0-9_-]{43}$/.test(id))
			throw new Error("Invalid font identity.");
		return join(this.directory, id);
	}
	async initialize(known: Set<string>): Promise<void> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const stat = await lstat(this.directory);
		if (!stat.isDirectory() || stat.isSymbolicLink())
			throw new Error("Invalid font cache.");
		for (const name of await readdir(this.directory)) {
			if (!known.has(name))
				await rm(join(this.directory, name), { force: true });
		}
	}
	async totalBytes(): Promise<number> {
		let total = 0;
		for (const name of await readdir(this.directory)) {
			const stat = await lstat(join(this.directory, name));
			if (!stat.isFile() || stat.isSymbolicLink())
				throw new Error("Invalid font cache entry.");
			total += stat.size;
		}
		return total;
	}
	async publish(asset: SubtitleFontAsset, bytes: Buffer): Promise<void> {
		const path = this.path(asset.id);
		const temporary = `${path}.pending`;
		try {
			const handle = await open(temporary, "wx", 0o600);
			try {
				await handle.writeFile(bytes);
				await handle.sync();
			} finally {
				await handle.close();
			}
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	async remove(asset: SubtitleFontAsset): Promise<void> {
		await rm(this.path(asset.id), { force: true });
	}
	async read(asset: SubtitleFontAsset, maximumBytes: number): Promise<Buffer> {
		const handle = await open(
			this.path(asset.id),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const stat = await handle.stat();
			if (
				!stat.isFile() ||
				stat.size !== asset.sizeBytes ||
				stat.size > maximumBytes
			)
				throw new Error("Invalid cached font size.");
			const bytes = Buffer.alloc(stat.size + 1);
			let length = 0;
			while (length < bytes.length) {
				const { bytesRead } = await handle.read(
					bytes,
					length,
					bytes.length - length,
					null,
				);
				if (!bytesRead) break;
				length += bytesRead;
			}
			const result = bytes.subarray(0, length);
			if (length !== asset.sizeBytes || fontDigest(result) !== asset.digest)
				throw new Error("Cached font changed.");
			const validated = validateFont(result);
			if (
				validated.format !== asset.format ||
				validated.family !== asset.family
			)
				throw new Error("Invalid font metadata.");
			return result;
		} finally {
			await handle.close();
		}
	}
}
