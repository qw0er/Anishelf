import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type {
	FileInfo,
	LibraryApi,
	ResourceAccessApi,
	SourceIdentity,
} from "../../resources/public.js";
import { identificationPolicy } from "../identification/policy.js";
import type {
	IdentificationApi,
	IdentificationResult,
} from "../identification/public.js";

interface CachedGroup {
	fingerprint: string;
	results: IdentificationResult[];
}
/** Application coordination, separate from recognition and durable Catalog decisions. */
export class AutomaticIdentificationCoordinator {
	private unsubscribe: (() => void) | undefined;
	private controller: AbortController | undefined;
	private active: Promise<void> | undefined;
	private requested = false;
	private failed = false;
	private closed = false;
	private cache = new Map<string, CachedGroup>();
	private results: IdentificationResult[] = [];
	constructor(
		private readonly options: {
			library: LibraryApi;
			sources: ResourceAccessApi;
			identification: IdentificationApi;
			logger: Logger;
			/** Complete successful publications, including empty roots, feed durable Catalog. */
			onPublication?: (
				results: readonly IdentificationResult[],
				canonicalRoot: string,
				signal: AbortSignal,
			) => void | Promise<void>;
		},
	) {}
	start(): void {
		if (this.closed || this.unsubscribe) return;
		this.unsubscribe = this.options.library.onSnapshotChanged(() => {
			this.controller?.abort();
			// Published results belong to the previous snapshot until revalidated.
			this.results = [];
			this.request();
		});
		this.request(); // Catch a startup scan that completed before assembly.
	}
	private request(): void {
		if (this.closed) return;
		this.requested = true;
		if (this.active) return;
		this.active = Promise.resolve()
			.then(async () => {
				while (this.requested && !this.closed) {
					this.requested = false;
					const controller = new AbortController();
					this.controller = controller;
					try {
						await this.synchronize(controller.signal);
						this.failed = false;
					} catch (err) {
						if (!controller.signal.aborted && !this.closed) {
							this.failed = true;
							this.options.logger.warn(
								{ event: "identification.automatic_failed", err },
								"Automatic identification failed; the next completed scan will retry.",
							);
						}
					}
				}
			})
			.finally(() => {
				this.active = undefined;
				this.controller = undefined;
			});
	}
	private async synchronize(signal: AbortSignal): Promise<void> {
		const epoch = this.options.sources.resourceRootEpoch;
		const status = await this.options.library.getStatus();
		signal.throwIfAborted();
		this.options.sources.assertRootEpoch(epoch);
		if (!status.ready || status.stale || !this.options.sources.hasSnapshot)
			return;
		const groups = new Map<string, FileInfo[]>();
		let offset: number | null = 0;
		while (offset !== null) {
			signal.throwIfAborted();
			const page = this.options.library.readFilePage(
				status.revision,
				offset,
				500,
			);
			for (const file of page.files) {
				const group = groups.get(file.parentId) ?? [];
				group.push(file);
				groups.set(file.parentId, group);
			}
			offset = page.nextOffset;
		}
		const next = new Map<string, CachedGroup>();
		const results: IdentificationResult[] = [];
		let changed = 0;
		for (const [directoryId, files] of groups) {
			files.sort(
				(a, b) =>
					a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"),
			);
			for (
				let start = 0;
				start < files.length;
				start += identificationPolicy.parserGroupSize
			) {
				const chunk = files.slice(
					start,
					start + identificationPolicy.parserGroupSize,
				);
				const sources: SourceIdentity[] = [];
				for (const file of chunk) {
					signal.throwIfAborted();
					this.options.sources.assertRootEpoch(epoch);
					try {
						const resolved = await this.options.sources.resolveSource(file.id);
						sources.push(resolved.identity);
					} catch (err) {
						signal.throwIfAborted();
						this.options.sources.assertRootEpoch(epoch);
						this.options.logger.warn(
							{
								event: "identification.source_unavailable",
								fileId: file.id,
								err,
							},
							"Scanned source is unavailable for identification.",
						);
					}
				}
				signal.throwIfAborted();
				this.options.sources.assertRootEpoch(epoch);
				if (!sources.length) continue;
				const key = JSON.stringify([
					sources[0]?.canonicalRoot,
					directoryId,
					start,
				]);
				const fingerprint = createHash("sha256")
					.update(
						JSON.stringify([this.options.identification.version, sources]),
					)
					.digest("hex");
				const cached = this.cache.get(key);
				let groupResults: IdentificationResult[];
				if (cached?.fingerprint === fingerprint) groupResults = cached.results;
				else {
					groupResults = await this.options.identification.identify(
						sources,
						signal,
					);
					changed += sources.length;
				}
				signal.throwIfAborted();
				this.options.sources.assertRootEpoch(epoch);
				// Resource versions may have changed while recognition/provider work was awaiting.
				for (const source of sources)
					await this.options.sources.revalidateSource({
						identity: source,
						rootEpoch: epoch,
					});
				signal.throwIfAborted();
				const current = await this.options.library.getStatus();
				if (current.revision !== status.revision)
					throw new Error("Library publication changed during identification.");
				signal.throwIfAborted();
				this.options.sources.assertRootEpoch(epoch);
				signal.throwIfAborted();
				this.options.sources.assertRootEpoch(epoch);
				results.push(...groupResults);
				// Failed provider work retains local evidence but is eligible for the next scan.
				if (groupResults.every((result) => result.metadataStatus !== "failed"))
					next.set(key, { fingerprint, results: groupResults });
			}
		}
		signal.throwIfAborted();
		this.options.sources.assertRootEpoch(epoch);
		const canonicalRoot = await this.options.sources.resolveRoot();
		signal.throwIfAborted();
		this.options.sources.assertRootEpoch(epoch);
		const current = await this.options.library.getStatus();
		if (current.revision !== status.revision)
			throw new Error("Library publication changed during identification.");
		signal.throwIfAborted();
		this.options.sources.assertRootEpoch(epoch);
		await this.options.onPublication?.(results, canonicalRoot, signal);
		signal.throwIfAborted();
		this.options.sources.assertRootEpoch(epoch);
		this.cache = next;
		this.results = results;
		this.options.logger.info(
			{
				event: "identification.automatic_completed",
				libraryRevision: status.revision,
				parsed: changed,
				available: results.length,
			},
			"Automatic local identification completed.",
		);
	}
	getStatus() {
		return { running: Boolean(this.active), failed: this.failed };
	}
	getResults(): IdentificationResult[] {
		return structuredClone(this.results);
	}
	async waitForCompletion(): Promise<void> {
		await this.active;
	}
	async close(): Promise<void> {
		this.closed = true;
		this.requested = false;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.controller?.abort();
		await this.active;
		this.cache.clear();
		this.results = [];
	}
}
