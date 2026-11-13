import { dirname, isAbsolute, sep, win32 } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import { nameCollator } from "../../../../shared/sorting.js";
import type {
	DirectoryEntry,
	FileEntry,
	LibraryEntry,
	LibrarySnapshot,
	ResourceId,
} from "../domain/model.js";
import { createResourceId } from "../domain/model.js";
import type { Timestamp } from "../domain/scan-state.js";
import { type LibraryPolicy, libraryPolicy } from "../policy.js";

function invalidSnapshot(): never {
	throw new DomainError(
		"SCAN_FAILED",
		"The scan produced an invalid library snapshot.",
	);
}

function compareEntries(
	left: LibraryEntry,
	right: LibraryEntry,
	policy: DeepReadonly<LibraryPolicy>,
	collator: Intl.Collator,
): number {
	if (policy.directoriesFirst && left.kind !== right.kind)
		return left.kind === "directory" ? -1 : 1;
	const compared = collator.compare(left.name, right.name);
	if (compared !== 0) return compared;
	return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function buildSnapshot(
	entries: readonly LibraryEntry[],
	revision: number,
	scannedAt: Timestamp | null,
	policy: DeepReadonly<LibraryPolicy>,
): LibrarySnapshot {
	const collator = nameCollator(policy);
	const entriesById = new Map<ResourceId, LibraryEntry>();
	const paths = new Set<string>();
	const childIdsByParent = new Map<ResourceId, ResourceId[]>();
	for (const entry of entries) {
		if (
			!entry.id ||
			entriesById.has(entry.id) ||
			paths.has(JSON.stringify([entry.scopeId, entry.relativePath]))
		)
			invalidSnapshot();
		const path = entry.relativePath;
		if (
			isAbsolute(path) ||
			win32.isAbsolute(path) ||
			path.includes("\0") ||
			(path !== "" &&
				path
					.split(sep)
					.some((part) => part === "" || part === "." || part === ".."))
		)
			invalidSnapshot();
		entriesById.set(entry.id, { ...entry });
		paths.add(JSON.stringify([entry.scopeId, path]));
		if (entry.kind === "directory") childIdsByParent.set(entry.id, []);
	}
	const root = entriesById.get("root");
	if (
		root?.kind !== "directory" ||
		root.parentId !== null ||
		root.relativePath !== ""
	)
		invalidSnapshot();
	for (const entry of entriesById.values()) {
		if (entry.id === "root") continue;
		const parent =
			entry.parentId === null ? undefined : entriesById.get(entry.parentId);
		const parentPath = dirname(entry.relativePath);
		if (
			parent?.kind !== "directory" ||
			(entry.relativePath === ""
				? parent.id !== "root" || parent.scopeId !== undefined
				: (parentPath === "." ? "" : parentPath) !== parent.relativePath ||
					parent.scopeId !== entry.scopeId)
		)
			invalidSnapshot();
		childIdsByParent.get(parent.id)?.push(entry.id);
	}
	for (const ids of childIdsByParent.values()) {
		ids.sort((left, right) =>
			compareEntries(
				entriesById.get(left) as LibraryEntry,
				entriesById.get(right) as LibraryEntry,
				policy,
				collator,
			),
		);
	}
	return { revision, scannedAt, rootId: "root", entriesById, childIdsByParent };
}

/** Owns one complete in-memory snapshot; queries never expose mutable index state. */
export class LibraryIndex {
	private current: LibrarySnapshot;

	constructor(
		rootName = "root",
		private policy: DeepReadonly<LibraryPolicy> = libraryPolicy,
	) {
		this.current = buildSnapshot(
			[
				{
					kind: "directory",
					id: "root",
					parentId: null,
					name: rootName,
					relativePath: "",
				},
			],
			0,
			null,
			this.policy,
		);
	}

	configure(policy: DeepReadonly<LibraryPolicy>): void {
		const next = buildSnapshot(
			[...this.current.entriesById.values()],
			this.current.revision,
			this.current.scannedAt,
			policy,
		);
		this.policy = policy;
		this.current = next;
	}
	get revision(): number {
		return this.current.revision;
	}

	/** Remove inactive scopes and remount retained entries while awaiting the next scan. */
	reset(roots: readonly { id: string; name: string }[] = []): void {
		const multiple = roots.length > 1;
		const entries: LibraryEntry[] = [];
		if (multiple || roots.length === 0)
			entries.push({
				kind: "directory",
				id: "root",
				parentId: null,
				name: multiple ? "Resources" : "root",
				relativePath: "",
			});
		for (const root of roots) {
			const mountId = multiple
				? createResourceId("directory", "", root.id)
				: "root";
			entries.push({
				kind: "directory",
				id: mountId,
				parentId: multiple ? "root" : null,
				scopeId: root.id,
				name: root.name,
				relativePath: "",
			});
			for (const entry of this.current.entriesById.values()) {
				if (entry.scopeId !== root.id || entry.relativePath === "") continue;
				entries.push({
					...entry,
					parentId:
						dirname(entry.relativePath) === "."
							? mountId
							: (entry.parentId ?? mountId),
				});
			}
		}
		this.current = buildSnapshot(
			entries,
			this.current.revision + 1,
			null,
			this.policy,
		);
	}

	get scannedAt(): Timestamp | null {
		return this.current.scannedAt;
	}

	/** Detached snapshot for consumers that need the whole index. */
	get snapshot(): LibrarySnapshot {
		return {
			...this.current,
			entriesById: new Map(
				[...this.current.entriesById].map(([id, entry]) => [id, { ...entry }]),
			),
			childIdsByParent: new Map(
				[...this.current.childIdsByParent].map(([id, children]) => [
					id,
					[...children],
				]),
			),
		};
	}

	/** Publish only after the complete candidate passes structural validation. */
	replace(
		entries: readonly LibraryEntry[],
		scannedAt: Timestamp = new Date().toISOString(),
	): void {
		if (!Number.isFinite(Date.parse(scannedAt))) invalidSnapshot();
		this.current = buildSnapshot(
			entries,
			this.current.revision + 1,
			scannedAt,
			this.policy,
		);
	}

	/** Read one bounded page from a specific immutable publication. */
	readFilePage(
		revision: number,
		offset: number,
		limit: number,
	): { files: FileEntry[]; nextOffset: number | null } {
		if (revision !== this.current.revision || this.current.scannedAt === null)
			throw new DomainError(
				"SCAN_FAILED",
				"The library publication changed or is not available.",
			);
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 500
		)
			throw new DomainError("INVALID_REQUEST", "Invalid library page.");
		const files: FileEntry[] = [];
		let skipped = 0;
		for (const entry of this.current.entriesById.values()) {
			if (entry.kind !== "file") continue;
			if (skipped++ < offset) continue;
			if (files.length === limit) return { files, nextOffset: offset + limit };
			files.push({ ...entry });
		}
		return { files, nextOffset: null };
	}

	/** Replace one mounted scope atomically, retaining all other roots. */
	replaceScope(scopeId: string, entries: readonly LibraryEntry[]): string[] {
		const root = this.findPath("", scopeId);
		const removals = root
			? root.id === "root"
				? this.listChildren(root.id).map((child) => child.id)
				: [root.id]
			: [];
		return this.apply(entries, removals);
	}

	findPath(path: string, scopeId?: string): LibraryEntry | undefined {
		const root = this.current.entriesById.get("root");
		if (path === "" && root && root.scopeId === scopeId) return { ...root };
		const file = this.current.entriesById.get(
			createResourceId("file", path, scopeId),
		);
		const entry =
			file ??
			this.current.entriesById.get(
				createResourceId("directory", path, scopeId),
			);
		return entry ? { ...entry } : undefined;
	}

	/** Copy maps, but inspect and sort only affected entries; publish the batch atomically. */
	apply(
		upserts: readonly LibraryEntry[],
		removals: readonly string[],
	): string[] {
		const entries = new Map(this.current.entriesById);
		const children = new Map<string, string[]>(
			[...this.current.childIdsByParent].map(([id, ids]) => [
				id,
				ids as string[],
			]),
		);
		const affected = new Set<string>();
		let changed = false;
		const touch = (id: string) => {
			if (!affected.has(id)) children.set(id, [...(children.get(id) ?? [])]);
			affected.add(id);
		};
		const remove = (id: string) => {
			const entry = entries.get(id);
			if (!entry || id === "root") return;
			if (entry.kind === "directory") {
				for (const child of [...(children.get(id) ?? [])]) remove(child);
				children.delete(id);
				affected.add(id);
			}
			if (entry.parentId) {
				touch(entry.parentId);
				children.set(
					entry.parentId,
					(children.get(entry.parentId) ?? []).filter((child) => child !== id),
				);
			}
			entries.delete(id);
			changed = true;
		};
		for (const id of removals) remove(id);
		for (const entry of upserts) {
			const previous = entries.get(entry.id);
			if (JSON.stringify(previous) === JSON.stringify(entry)) continue;
			if (
				entry.id !== "root" &&
				entry.id !==
					createResourceId(entry.kind, entry.relativePath, entry.scopeId)
			)
				invalidSnapshot();
			const parent = entry.parentId ? entries.get(entry.parentId) : undefined;
			if (
				entry.id !== "root" &&
				(parent?.kind !== "directory" ||
					(entry.relativePath === ""
						? parent.id !== "root" || parent.scopeId !== undefined
						: parent.scopeId !== entry.scopeId ||
							(dirname(entry.relativePath) === "."
								? ""
								: dirname(entry.relativePath)) !== parent.relativePath))
			)
				invalidSnapshot();
			entries.set(entry.id, { ...entry });
			if (entry.kind === "directory" && !children.has(entry.id))
				children.set(entry.id, []);
			if (entry.parentId) {
				touch(entry.parentId);
				if (!previous) children.get(entry.parentId)?.push(entry.id);
			}
			changed = true;
		}
		if (!changed) return [];
		const collator = nameCollator(this.policy);
		for (const id of affected)
			children
				.get(id)
				?.sort((a, b) =>
					compareEntries(
						entries.get(a) as LibraryEntry,
						entries.get(b) as LibraryEntry,
						this.policy,
						collator,
					),
				);
		this.current = {
			...this.current,
			revision: this.current.revision + 1,
			entriesById: entries,
			childIdsByParent: children,
		};
		return [...affected];
	}

	getEntry(id: ResourceId): LibraryEntry {
		const entry = this.current.entriesById.get(id);
		if (!entry)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"The resource was not found.",
			);
		return { ...entry };
	}

	getDirectory(id: ResourceId): DirectoryEntry {
		const entry = this.getEntry(id);
		if (entry.kind !== "directory")
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"The directory was not found.",
			);
		return entry;
	}

	getFile(id: ResourceId): FileEntry {
		const entry = this.getEntry(id);
		if (entry.kind !== "file")
			throw new DomainError("RESOURCE_NOT_FOUND", "The file was not found.");
		return entry;
	}

	listChildren(directoryId: ResourceId): LibraryEntry[] {
		this.getDirectory(directoryId);
		return (this.current.childIdsByParent.get(directoryId) ?? []).map((id) =>
			this.getEntry(id),
		);
	}

	searchDescendants(
		directoryId: ResourceId,
		query: string,
	): { entry: LibraryEntry; parentPath: string[] }[] {
		this.getDirectory(directoryId);
		const term = query.toLowerCase();
		const matches: { entry: LibraryEntry; parentPath: string[] }[] = [];
		const pending = [{ id: directoryId, path: [] as string[] }];
		while (pending.length) {
			const current = pending.pop();
			if (!current) break;
			for (const entry of this.listChildren(current.id)) {
				if (entry.name.toLowerCase().includes(term))
					matches.push({ entry, parentPath: current.path });
				if (entry.kind === "directory")
					pending.push({ id: entry.id, path: [...current.path, entry.name] });
			}
		}
		const collator = nameCollator(this.policy);
		matches.sort(
			(a, b) =>
				compareEntries(a.entry, b.entry, this.policy, collator) ||
				collator.compare(a.parentPath.join("/"), b.parentPath.join("/")) ||
				a.entry.id.localeCompare(b.entry.id),
		);
		return matches;
	}
}
