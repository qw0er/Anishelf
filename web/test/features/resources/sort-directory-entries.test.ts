import { expect, test } from "vitest";
import { sortDirectoryEntries } from "../../../src/features/resources/library/sort-directory-entries.js";
import type { ResourceDto } from "../../../src/shared/api/contracts.js";

const file = {
	kind: "file",
	parentId: "root",
	mimeType: "video/mp4",
} as const;
const entries: ResourceDto[] = [
	{ kind: "directory", id: "d1", parentId: "root", name: "First" },
	{ kind: "directory", id: "d2", parentId: "root", name: "Second" },
	{
		...file,
		id: "f1",
		name: "Episode 2.mp4",
		sizeBytes: 200,
		modifiedAt: "2026-01-02T00:00:00.000Z",
	},
	{
		...file,
		id: "f2",
		name: "Episode 10.mp4",
		sizeBytes: 100,
		modifiedAt: "2026-01-01T00:00:00.000Z",
	},
];

test.each([
	["default", ["d1", "d2", "f1", "f2"]],
	["name-desc", ["d2", "d1", "f2", "f1"]],
	["size-asc", ["d1", "d2", "f2", "f1"]],
	["size-desc", ["d1", "d2", "f1", "f2"]],
	["modified-asc", ["d1", "d2", "f2", "f1"]],
	["modified-desc", ["d1", "d2", "f1", "f2"]],
])(
	"keeps folders first in %s order without mutating the listing",
	(sort, ids) => {
		expect(
			sortDirectoryEntries(entries, sort).map((entry) => entry.id),
		).toEqual(ids);
		expect(entries.map((entry) => entry.id)).toEqual(["d1", "d2", "f1", "f2"]);
	},
);
