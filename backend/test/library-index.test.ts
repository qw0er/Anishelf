import { join } from "node:path";
import { expect, test } from "vitest";
import { builtinPolicy } from "../src/modules/configuration/domain/policy.js";
import type {
	DirectoryEntry,
	FileEntry,
	LibraryEntry,
} from "../src/modules/library/domain/model.js";
import { createResourceId } from "../src/modules/library/domain/model.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";

const root: DirectoryEntry = {
	kind: "directory",
	id: "root",
	parentId: null,
	name: "Media",
	relativePath: "",
};
const scannedAt = "2026-09-28T12:00:00.000Z";
function directory(name: string): DirectoryEntry {
	return {
		kind: "directory",
		id: createResourceId("directory", name),
		parentId: "root",
		name,
		relativePath: name,
	};
}
function file(name: string, parent: DirectoryEntry = root): FileEntry {
	const relativePath = join(parent.relativePath, name);
	return {
		kind: "file",
		id: createResourceId("file", relativePath),
		parentId: parent.id,
		name,
		relativePath,
		sizeBytes: 123,
		modifiedAt: scannedAt,
		mimeType: "video/mp4",
	};
}

test("initial index has only a root, revision zero, and no scan timestamp", () => {
	const index = new LibraryIndex("Media");
	expect(index.revision).toBe(0);
	expect(index.scannedAt).toBeNull();
	expect(index.snapshot.entriesById.size).toBe(1);
	expect(index.getDirectory("root")).toEqual(root);
	expect(index.listChildren("root")).toEqual([]);
});

test("resource IDs are stable and distinguish kinds and paths", () => {
	expect(createResourceId("directory", "")).toBe("root");
	expect(createResourceId("file", "中文 episode 1.mp4")).toBe(
		createResourceId("file", "中文 episode 1.mp4"),
	);
	expect(createResourceId("file", "a")).not.toBe(
		createResourceId("directory", "a"),
	);
	expect(createResourceId("file", "a")).not.toBe(createResourceId("file", "b"));
	expect(createResourceId("file", "a")).not.toContain("/a");
});

test("folders precede files and names use numeric ordering with an exact-name tie breaker", () => {
	const index = new LibraryIndex();
	index.replace(
		[
			root,
			file("Episode 10.mp4"),
			file("a.mp4"),
			directory("Folder 10"),
			file("Episode 2.mp4"),
			directory("Folder 2"),
			file("A.mp4"),
		],
		scannedAt,
	);
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"Folder 2",
		"Folder 10",
		"A.mp4",
		"a.mp4",
		"Episode 2.mp4",
		"Episode 10.mp4",
	]);
	const first = index.listChildren("root").map((entry) => entry.id);
	index.replace([...index.snapshot.entriesById.values()].reverse(), scannedAt);
	expect(index.listChildren("root").map((entry) => entry.id)).toEqual(first);
});

test("lists only immediate children and resolves directory and file records", () => {
	const index = new LibraryIndex();
	const folder = directory("中文 folder");
	const video = file("episode 1.mp4", folder);
	index.replace([video, folder, root], scannedAt);
	expect(index.listChildren("root")).toEqual([folder]);
	expect(index.listChildren(folder.id)).toEqual([video]);
	expect(index.getFile(video.id)).toEqual(video);
	expect(index.getEntry(folder.id)).toEqual(folder);
});

test("replacement removes old files, advances revision, and leaves saved snapshots unchanged", () => {
	const index = new LibraryIndex();
	const oldFile = file("old.mp4");
	const keptFile = file("kept.mp4");
	index.replace([root, oldFile, keptFile], scannedAt);
	const oldSnapshot = index.snapshot;
	index.replace([root, keptFile]);
	expect(index.revision).toBe(2);
	expect(index.scannedAt).not.toBeNull();
	expect(index.getFile(keptFile.id)).toEqual(keptFile);
	expect(() => index.getEntry(oldFile.id)).toThrow();
	expect(oldSnapshot.revision).toBe(1);
	expect(oldSnapshot.entriesById.has(oldFile.id)).toBe(true);
});

test("query results and publication inputs cannot mutate the active index", () => {
	const index = new LibraryIndex();
	const video = file("episode.mp4");
	index.replace([root, video], scannedAt);
	video.name = "changed input";
	index.getFile(video.id).name = "changed query";
	const listedEntry = index.listChildren("root")[0];
	if (!listedEntry) throw new Error("Expected a child entry");
	listedEntry.name = "changed listing";
	const snapshot = index.snapshot;
	const snapshotEntry = snapshot.entriesById.get(video.id);
	if (!snapshotEntry) throw new Error("Expected a snapshot entry");
	snapshotEntry.name = "changed snapshot";
	(snapshot.entriesById as Map<string, LibraryEntry>).clear();
	(snapshot.childIdsByParent.get("root") as string[]).length = 0;
	expect(index.getFile(video.id).name).toBe("episode.mp4");
	expect(index.listChildren("root")).toHaveLength(1);
});

test("unknown IDs and wrong-kind lookups use RESOURCE_NOT_FOUND", () => {
	const index = new LibraryIndex();
	const video = file("episode.mp4");
	index.replace([root, video], scannedAt);
	for (const query of [
		() => index.getEntry("missing"),
		() => index.getFile("root"),
		() => index.getDirectory(video.id),
		() => index.listChildren(video.id),
	]) {
		expect(query).toThrow(
			expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }),
		);
	}
});

test.each([
	["missing root", [file("episode.mp4")]],
	["invalid root", [{ ...root, parentId: "other" }]],
	["duplicate ID", [root, file("episode.mp4"), file("episode.mp4")]],
	[
		"duplicate path",
		[root, file("episode.mp4"), { ...file("episode.mp4"), id: "another-id" }],
	],
	["missing parent", [root, { ...file("episode.mp4"), parentId: "missing" }]],
	[
		"wrong parent path",
		[
			root,
			directory("folder"),
			file("episode.mp4", { ...root, relativePath: "folder" }),
		],
	],
	[
		"traversal",
		[root, { ...file("episode.mp4"), relativePath: "../outside.mp4" }],
	],
	[
		"absolute path",
		[root, { ...file("episode.mp4"), relativePath: "/outside.mp4" }],
	],
] as const)(
	"invalid candidate preserves the previous snapshot: %s",
	(_name, entries) => {
		const index = new LibraryIndex();
		index.replace([root, file("kept.mp4")], scannedAt);
		const previous = index.snapshot;
		expect(() => index.replace(entries, scannedAt)).toThrow(
			expect.objectContaining({ code: "SCAN_FAILED" }),
		);
		expect(index.snapshot).toEqual(previous);
	},
);

test("rejects an invalid scan timestamp without advancing revision", () => {
	const index = new LibraryIndex();
	expect(() => index.replace([root], "invalid time")).toThrow();
	expect(index.revision).toBe(0);
});

test("injected sorting changes directory priority and numeric ordering", () => {
	const index = new LibraryIndex();
	index.replace(
		[root, directory("z"), file("episode2.mp4"), file("episode10.mp4")],
		scannedAt,
	);
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"z",
		"episode2.mp4",
		"episode10.mp4",
	]);
	index.configure({
		...builtinPolicy.library,
		directoriesFirst: false,
		sortNumeric: false,
	});
	expect(index.listChildren("root").map((entry) => entry.name)).toEqual([
		"episode10.mp4",
		"episode2.mp4",
		"z",
	]);
	expect(index.revision).toBe(1);
});
