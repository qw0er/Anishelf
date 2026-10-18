import { basename, dirname, join, sep } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type {
	ResourceFiles,
	ResourceRoot,
	ResourceRootsApi,
} from "../../resource-access/public.js";
import { getVideoMimeType } from "../../resource-access/public.js";
import { createResourceId, type LibraryEntry } from "../domain/model.js";
import type { LibraryIndex } from "../infrastructure/index.js";
import type { LibraryRuntimePolicy } from "../policy.js";

/** Builds path-scoped patches through confined access; index mutation belongs to synchronization. */
export class ChangeProcessor {
	constructor(
		private readonly options: {
			roots: ResourceRootsApi;
			index: LibraryIndex;
			policy: DeepReadonly<LibraryRuntimePolicy>;
		},
	) {}
	async read(
		root: ResourceRoot,
		paths: readonly string[],
		signal: AbortSignal,
	) {
		const resources = await this.options.roots.open(root);
		const index = this.options.index;
		const videoMimeTypes = this.options.policy.resourceAccess.videoMimeTypes;
		const scopeId = resources.scopeId;
		const upserts = new Map<string, LibraryEntry>();
		const removals = new Set<string>();
		const directories = new Map<
			string,
			Awaited<ReturnType<ResourceFiles["readDirectory"]>>
		>();
		const read = async (path: string) => {
			let children = directories.get(path);
			if (!children) {
				children = await resources.readDirectory(path);
				directories.set(path, children);
			}
			return children;
		};
		const visit = async (path: string): Promise<void> => {
			signal.throwIfAborted();
			if (!path) return;
			const parentPath = dirname(path) === "." ? "" : dirname(path);
			const parentId =
				index.findPath(parentPath, scopeId)?.id ??
				createResourceId("directory", parentPath, scopeId);
			if (!index.findPath(parentPath, scopeId) && !upserts.has(parentId))
				await visit(parentPath);
			let child: Awaited<ReturnType<typeof read>>[number] | undefined;
			try {
				child = (await read(parentPath)).find(
					(item) => item.name === basename(path),
				);
			} catch (error) {
				if (
					!(
						error instanceof DomainError && error.code === "RESOURCE_MISSING"
					) &&
					(error as NodeJS.ErrnoException).code !== "ENOENT"
				)
					throw error;
			}
			const previous = index.findPath(path, scopeId);
			if (
				!child ||
				child.isSymbolicLink() ||
				(!child.isDirectory() &&
					(!child.isFile() || !getVideoMimeType(child.name, videoMimeTypes)))
			) {
				if (previous) removals.add(previous.id);
				return;
			}
			const kind = child.isDirectory() ? "directory" : "file";
			if (previous && previous.kind !== kind) removals.add(previous.id);
			const id = createResourceId(kind, path, scopeId);
			if (kind === "directory") {
				upserts.set(id, {
					kind,
					scopeId,
					id,
					parentId,
					name: child.name,
					relativePath: path,
				});
				// Only newly discovered subtrees require recursive discovery.
				if (previous?.kind !== "directory")
					for (const entry of await read(path))
						await visit(join(path, entry.name));
			} else {
				upserts.set(id, {
					kind,
					scopeId,
					id,
					parentId,
					name: child.name,
					relativePath: path,
					...(await resources.inspectVideoFileWithVersion(path)),
				});
			}
		};
		for (const path of [...new Set(paths)].sort(
			(a, b) => a.split(sep).length - b.split(sep).length,
		))
			await visit(path);
		// An unavailable root must never turn a batch of missing paths into deletions.
		await resources.readDirectory();
		signal.throwIfAborted();
		return { upserts: [...upserts.values()], removals: [...removals] };
	}
}
