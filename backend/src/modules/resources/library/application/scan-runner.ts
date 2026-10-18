import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type {
	ResourceRoot,
	ResourceRootsApi,
} from "../../resource-access/public.js";
import {
	createResourceId,
	type LibraryEntry,
	type LibrarySnapshot,
} from "../domain/model.js";
import type {
	LibraryScanner,
	ScanTraversalProgress,
} from "../infrastructure/scanner.js";

interface RootScanResult {
	scopeId: string;
	healthy: boolean;
	error?: unknown;
}
/** Builds candidates for baseline scans and strict root recovery; it never publishes or schedules. */
export class ScanRunner {
	constructor(
		private readonly options: {
			roots: ResourceRootsApi;
			scanner: LibraryScanner;
			logger: Logger;
			warningMessageLimit: number;
		},
	) {}
	private async readRoot(
		root: ResourceRoot,
		mount: boolean,
		progress: ScanTraversalProgress,
		signal: AbortSignal,
	) {
		signal.throwIfAborted();
		const resources = await this.options.roots.open(root);
		return this.options.scanner.scan(
			resources,
			root.name,
			progress,
			signal,
			undefined,
			mount,
		);
	}
	async reconcile(
		root: ResourceRoot,
		mount: boolean,
		signal: AbortSignal,
	): Promise<LibraryEntry[] | null> {
		const progress: ScanTraversalProgress = {
			id: randomUUID(),
			visitedCount: 0,
			matchedCount: 0,
			warnings: { count: 0, messages: [] },
		};
		const entries = await this.readRoot(root, mount, progress, signal);
		if (entries && progress.warnings.count)
			throw new Error(
				"Reconciliation could not read every resource; previous entries retained.",
			);
		return entries;
	}
	async baseline(
		roots: readonly ResourceRoot[],
		previous: LibrarySnapshot,
		progress: ScanTraversalProgress,
		signal: AbortSignal,
		onRootResult: (result: RootScanResult) => void,
	): Promise<LibraryEntry[] | null> {
		const mount = roots.length > 1;
		const entries: LibraryEntry[] = mount
			? [
					{
						kind: "directory",
						id: "root",
						parentId: null,
						name: "Resources",
						relativePath: "",
					},
				]
			: [];
		let completed = 0;
		for (const root of roots) {
			if (signal.aborted) return null;
			const warningsBefore = progress.warnings.count;
			try {
				const scanned = await this.readRoot(root, mount, progress, signal);
				if (scanned === null || signal.aborted) return null;
				entries.push(...scanned);
				completed++;
				onRootResult({
					scopeId: root.scopeId,
					healthy: progress.warnings.count === warningsBefore,
				});
				this.options.logger.debug(
					{
						event: "scan.root_completed",
						scanId: progress.id,
						scopeId: root.scopeId,
					},
					"Resource directory scan completed.",
				);
			} catch (error) {
				if (signal.aborted) return null;
				if (
					!(error instanceof DomainError) ||
					error.code !== "RESOURCE_ROOT_UNAVAILABLE"
				)
					throw error;
				onRootResult({ scopeId: root.scopeId, healthy: false, error });
				const retained = [...previous.entriesById.values()].filter(
					(entry) => entry.scopeId === root.scopeId,
				);
				entries.push(...retained);
				if (!retained.length)
					entries.push({
						kind: "directory",
						id: mount
							? createResourceId("directory", "", root.scopeId)
							: "root",
						parentId: mount ? "root" : null,
						scopeId: root.scopeId,
						name: root.name,
						relativePath: "",
					});
				progress.warnings.count++;
				const message =
					"A resource directory is unavailable; its previous index was retained.";
				if (
					!progress.warnings.messages.includes(message) &&
					progress.warnings.messages.length < this.options.warningMessageLimit
				)
					progress.warnings.messages = [...progress.warnings.messages, message];
				this.options.logger.warn(
					{
						event: "scan.root_failed",
						scanId: progress.id,
						scopeId: root.scopeId,
						retainedEntries: retained.length,
						errorName: error.name,
					},
					"Resource directory scan failed; retaining its previous index.",
				);
			}
		}
		if (!completed)
			throw new DomainError(
				"RESOURCE_ROOT_UNAVAILABLE",
				"All resource directories are unavailable.",
			);
		return signal.aborted ? null : entries;
	}
}
