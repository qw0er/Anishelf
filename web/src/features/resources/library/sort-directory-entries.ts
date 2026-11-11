import type { ResourceDto } from "../../../shared/api/contracts.js";

export function sortDirectoryEntries(
	entries: readonly ResourceDto[],
	sort: string,
) {
	const children = [...entries];
	if (sort !== "default") {
		children.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
			if (sort === "name-desc") return 0; // Reversed within each group below.
			if (a.kind === "directory" || b.kind === "directory") return 0;
			if (sort === "size-asc") return a.sizeBytes - b.sizeBytes;
			if (sort === "size-desc") return b.sizeBytes - a.sizeBytes;
			if (sort === "modified-asc")
				return a.modifiedAt.localeCompare(b.modifiedAt);
			if (sort === "modified-desc")
				return b.modifiedAt.localeCompare(a.modifiedAt);
			return 0;
		});
		if (sort === "name-desc") {
			const directories = children
				.filter((entry) => entry.kind === "directory")
				.reverse();
			const files = children.filter((entry) => entry.kind === "file").reverse();
			children.splice(0, children.length, ...directories, ...files);
		}
	}
	return children;
}
