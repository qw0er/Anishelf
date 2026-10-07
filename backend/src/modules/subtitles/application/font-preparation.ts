import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Logger } from "pino";
import type { MediaInfo } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type {
	ResolvedSource,
	ResourceAccessApi,
} from "../../resource-access/public.js";
import type {
	SubtitleFontAsset,
	SubtitleFontSet,
	SubtitleFonts,
} from "../domain/model.js";
import type { SubtitlePolicy } from "../domain/policy.js";
import {
	fontDigest,
	SubtitleFontFiles,
	validateFont,
} from "../infrastructure/fonts.js";
import type { SubtitleRepository } from "../infrastructure/repository.js";
import type { SubtitleExtractor } from "../ports.js";

/** Font work is shared by source version, independently of selected subtitle track. */
export class SubtitleFontPreparation {
	private readonly files: SubtitleFontFiles;
	private initialization: Promise<void> | undefined;
	private readonly controller = new AbortController();
	private readonly requests = new Map<string, Promise<SubtitleFonts>>();
	private readonly active = new Map<string, Promise<void>>();
	private publication: Promise<void> = Promise.resolve();
	constructor(
		private readonly options: {
			dataDir: string;
			repository: SubtitleRepository;
			sources: ResourceAccessApi;
			tools: SubtitleExtractor;
			policy: DeepReadonly<SubtitlePolicy>;
			logger?: Logger;
		},
	) {
		this.files = new SubtitleFontFiles(options.dataDir);
	}
	initialize(): Promise<void> {
		this.initialization ??= this.reconcile();
		return this.initialization;
	}
	private async reconcile(): Promise<void> {
		const sets = this.options.repository.listFonts();
		await this.files.initialize(
			new Set(sets.flatMap((set) => set.assets.map((asset) => asset.id))),
		);
		for (const set of sets) {
			if (set.status === "pending") {
				set.status = "degraded";
				set.warnings = ["FONT_INTERRUPTED"];
			}
			await this.check(set);
			this.options.repository.saveFonts(set);
		}
	}
	private async check(set: SubtitleFontSet): Promise<void> {
		const valid: SubtitleFontAsset[] = [];
		let total = 0;
		for (const asset of set.assets) {
			try {
				await this.files.read(asset, this.options.policy.fontMaximumBytes);
				if (
					valid.length >= this.options.policy.fontMaximumCount ||
					total + asset.sizeBytes > this.options.policy.fontSetMaximumBytes
				)
					throw new Error("Font set exceeds limits.");
				valid.push(asset);
				total += asset.sizeBytes;
			} catch {
				await this.files.remove(asset);
				set.status = "degraded";
				if (!set.warnings.includes("FONT_CACHE_INVALID"))
					set.warnings.push("FONT_CACHE_INVALID");
			}
		}
		set.assets = valid;
	}
	private view(set: SubtitleFontSet): SubtitleFonts {
		return {
			id: set.id,
			status: set.status,
			assets: set.assets,
			warnings: set.warnings,
		};
	}
	async prepare(
		source: ResolvedSource,
		info?: MediaInfo,
	): Promise<SubtitleFonts> {
		const id = `fontset_${createHash("sha256")
			.update(
				JSON.stringify([
					source.identity.canonicalRoot,
					source.identity.fileId,
					source.identity.sourceVersion,
					"font-extraction-v1",
				]),
			)
			.digest("base64url")}`;
		const existingRequest = this.requests.get(id);
		if (existingRequest) return existingRequest;
		const request = this.prepareSet(source, info, id);
		this.requests.set(id, request);
		try {
			return await request;
		} finally {
			this.requests.delete(id);
		}
	}
	private async prepareSet(
		source: ResolvedSource,
		info: MediaInfo | undefined,
		id: string,
	): Promise<SubtitleFonts> {
		const set: SubtitleFontSet = {
			id,
			source: source.identity,
			status: "pending",
			assets: [],
			warnings: [],
		};
		await this.options.sources.revalidateSource(source);
		if (this.controller.signal.aborted)
			return {
				...this.view(set),
				status: "degraded",
				warnings: ["FONT_INTERRUPTED"],
			};
		try {
			await this.initialize();
		} catch (err) {
			this.options.logger?.warn(
				{ event: "subtitles.font_cache_unavailable", err },
				"Font cache unavailable.",
			);
			return {
				...this.view(set),
				status: "degraded",
				warnings: ["FONT_CACHE_UNAVAILABLE"],
			};
		}
		const existing = this.options.repository.getFonts(id);
		if (this.active.has(id)) return this.view(existing ?? set);
		if (existing?.status === "ready") {
			await this.check(existing);
			this.options.repository.saveFonts(existing);
			if (existing.status === "ready") {
				await this.options.sources.revalidateSource(source);
				return this.view(existing);
			}
		}
		if (!info || !this.options.tools.extractAttachment)
			return {
				...this.view(set),
				status: "degraded",
				warnings: ["FONT_INSPECTION_UNAVAILABLE"],
			};
		if (this.active.size >= this.options.policy.fontExtractionConcurrency)
			return {
				...this.view(set),
				status: "degraded",
				warnings: ["FONT_PREPARATION_BUSY"],
			};
		if (this.controller.signal.aborted)
			return {
				...this.view(set),
				status: "degraded",
				warnings: ["FONT_INTERRUPTED"],
			};
		this.options.repository.saveFonts(set);
		const work = this.extract(set, source, info, existing)
			.catch((err) => {
				this.options.logger?.error(
					{ event: "subtitles.font_persistence_failed", err },
					"Font preparation persistence failed.",
				);
			})
			.finally(() => this.active.delete(id));
		this.active.set(id, work);
		return this.view(set);
	}
	private async extract(
		set: SubtitleFontSet,
		source: ResolvedSource,
		info: MediaInfo,
		previous?: SubtitleFontSet,
	): Promise<void> {
		const warnings = new Set<string>();
		const staged: { asset: SubtitleFontAsset; bytes: Buffer }[] = [];
		let total = 0;
		try {
			const candidates = info.streams.filter(
				(stream) =>
					stream.type === "attachment" &&
					(["ttf", "otf"].includes(stream.codec ?? "") ||
						/\.(ttf|otf)$/i.test(stream.tags.filename ?? "") ||
						[
							"font/ttf",
							"font/otf",
							"application/x-truetype-font",
							"application/vnd.ms-opentype",
							"application/x-font-ttf",
							"application/x-font-opentype",
						].includes(stream.tags.mimetype ?? "")),
			);
			if (candidates.length > this.options.policy.fontMaximumCount)
				warnings.add("FONT_LIMIT_EXCEEDED");
			for (const stream of candidates.slice(
				0,
				this.options.policy.fontMaximumCount,
			)) {
				this.controller.signal.throwIfAborted();
				try {
					const bytes = await this.options.tools.extractAttachment?.(
						join(source.identity.canonicalRoot, source.identity.relativePath),
						stream.index,
						{
							maximumBytes: this.options.policy.fontMaximumBytes,
							signal: this.controller.signal,
						},
					);
					if (!bytes || bytes.length > this.options.policy.fontMaximumBytes)
						throw new Error("Invalid font output.");
					const metadata = validateFont(bytes);
					if (total + bytes.length > this.options.policy.fontSetMaximumBytes) {
						warnings.add("FONT_LIMIT_EXCEEDED");
						continue;
					}
					const digest = fontDigest(bytes);
					if (staged.some((item) => item.asset.digest === digest)) continue;
					const id = `font_${createHash("sha256").update(`${set.id}:${stream.index}:${digest}`).digest("base64url")}`;
					staged.push({
						bytes,
						asset: {
							id,
							streamIndex: stream.index,
							...metadata,
							digest,
							sizeBytes: bytes.length,
						},
					});
					total += bytes.length;
				} catch (err) {
					this.controller.signal.throwIfAborted();
					warnings.add("FONT_EXTRACTION_FAILED");
					this.options.logger?.warn(
						{
							event: "subtitles.font_extraction_failed",
							setId: set.id,
							streamIndex: stream.index,
							err,
						},
						"Font attachment unavailable.",
					);
				}
			}
			const publication = this.publication.then(async () => {
				await this.options.sources.revalidateSource(source);
				this.controller.signal.throwIfAborted();
				if (previous)
					for (const asset of previous.assets) await this.files.remove(asset);
				if (
					(await this.files.totalBytes()) + total >
					this.options.policy.fontMaximumCacheBytes
				) {
					warnings.add("FONT_CACHE_FULL");
					staged.length = 0;
				}
				for (const { asset, bytes } of staged) {
					await this.files.publish(asset, bytes);
					set.assets.push(asset);
				}
				await this.options.sources.revalidateSource(source);
				this.controller.signal.throwIfAborted();
				set.warnings = [...warnings];
				set.status = warnings.size ? "degraded" : "ready";
				this.options.repository.saveFonts(set);
			});
			this.publication = publication.catch(() => {});
			await publication;
			this.options.logger?.info(
				{
					event: "subtitles.font_prepared",
					setId: set.id,
					count: set.assets.length,
					sizeBytes: total,
					status: set.status,
				},
				"Font set prepared.",
			);
		} catch (err) {
			for (const asset of set.assets) await this.files.remove(asset);
			set.assets = [];
			set.status = "degraded";
			set.warnings = [
				this.controller.signal.aborted
					? "FONT_INTERRUPTED"
					: err instanceof DomainError && err.code === "PLAYBACK_CONFLICT"
						? "PLAYBACK_CONFLICT"
						: "FONT_PREPARATION_FAILED",
			];
			this.options.repository.saveFonts(set);
		}
	}
	private async set(id: string): Promise<SubtitleFontSet> {
		await this.initialize();
		const set = this.options.repository.getFonts(id);
		if (!set) throw new DomainError("RESOURCE_NOT_FOUND", "Unknown font set.");
		await this.options.sources.revalidateSource({ identity: set.source });
		return set;
	}
	async status(id: string): Promise<SubtitleFonts> {
		const set = await this.set(id);
		if (set.status === "pending" && !this.active.has(id)) {
			set.status = "degraded";
			set.warnings = ["FONT_INTERRUPTED"];
		}
		if (set.status !== "pending") {
			await this.check(set);
			this.options.repository.saveFonts(set);
		}
		await this.options.sources.revalidateSource({ identity: set.source });
		return this.view(set);
	}
	async content(
		id: string,
		fontId: string,
	): Promise<{ bytes: Buffer; format: "ttf" | "otf" }> {
		const set = await this.set(id);
		const asset = set.assets.find((candidate) => candidate.id === fontId);
		if (!asset || set.status === "pending")
			throw new DomainError("RESOURCE_NOT_FOUND", "Unknown font asset.");
		try {
			const bytes = await this.files.read(
				asset,
				this.options.policy.fontMaximumBytes,
			);
			await this.options.sources.revalidateSource({ identity: set.source });
			return { bytes, format: asset.format };
		} catch (error) {
			if (error instanceof DomainError) throw error;
			await this.check(set);
			this.options.repository.saveFonts(set);
			throw new DomainError("RESOURCE_NOT_FOUND", "Font asset unavailable.");
		}
	}
	async close(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.requests.values());
		await Promise.allSettled(this.active.values());
	}
}
