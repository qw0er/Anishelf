import { basename, dirname, join, sep } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import type { ResourceFiles } from "../../resource-access/public.js";
import { getVideoMimeType } from "../../resource-access/public.js";
import { createResourceId, type LibraryEntry } from "../domain/model.js";
import type { LibraryIndex } from "./index.js";

/** Re-read event paths through confined access; events never determine authoritative state. */
export async function readChanges(
	resources: ResourceFiles,
	index: LibraryIndex,
	paths: readonly string[],
	videoMimeTypes: Readonly<Record<string, string>>,
) {
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
				!(error instanceof DomainError && error.code === "RESOURCE_MISSING") &&
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
	return { upserts: [...upserts.values()], removals: [...removals] };
}
