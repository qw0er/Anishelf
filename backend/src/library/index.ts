import { createHash } from "node:crypto";
import { dirname, isAbsolute, sep, win32 } from "node:path";
import type {
	DirectoryEntry,
	FileEntry,
	LibraryEntry,
	LibrarySnapshot,
	ResourceId,
	Timestamp,
} from "../contracts/library.js";
import { DomainError } from "../errors.js";

const nameCollator = new Intl.Collator("en", {
	numeric: true,
	sensitivity: "base",
});

/** Stable lookup key for an unchanged kind and root-relative path. */
export function createResourceId(
	kind: LibraryEntry["kind"],
	relativePath: string,
): ResourceId {
	if (kind === "directory" && relativePath === "") return "root";
	return `${kind}_${createHash("sha256").update(kind).update("\0").update(relativePath).digest("base64url")}`;
}

function invalidSnapshot(): never {
	throw new DomainError(
		"SCAN_FAILED",
		"The scan produced an invalid library snapshot.",
	);
}

function compareEntries(left: LibraryEntry, right: LibraryEntry): number {
	if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
	const compared = nameCollator.compare(left.name, right.name);
	if (compared !== 0) return compared;
	return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function buildSnapshot(
	entries: readonly LibraryEntry[],
	revision: number,
	scannedAt: Timestamp | null,
): LibrarySnapshot {
	const entriesById = new Map<ResourceId, LibraryEntry>();
	const paths = new Set<string>();
	const childIdsByParent = new Map<ResourceId, ResourceId[]>();
	for (const entry of entries) {
		if (!entry.id || entriesById.has(entry.id) || paths.has(entry.relativePath))
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
		paths.add(path);
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
			(parentPath === "." ? "" : parentPath) !== parent.relativePath
		)
			invalidSnapshot();
		childIdsByParent.get(parent.id)?.push(entry.id);
	}
	for (const ids of childIdsByParent.values()) {
		ids.sort((left, right) =>
			compareEntries(
				entriesById.get(left) as LibraryEntry,
				entriesById.get(right) as LibraryEntry,
			),
		);
	}
	return { revision, scannedAt, rootId: "root", entriesById, childIdsByParent };
}

/** Owns one complete in-memory snapshot; queries never expose mutable index state. */
export class LibraryIndex {
	private current: LibrarySnapshot;

	constructor(rootName = "root") {
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
		);
	}

	get revision(): number {
		return this.current.revision;
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
		this.current = buildSnapshot(entries, this.current.revision + 1, scannedAt);
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
}
