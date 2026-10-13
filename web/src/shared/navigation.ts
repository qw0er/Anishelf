export function directoryPath(id: string): string {
	return id === "root" ? "/" : `/directories/${encodeURIComponent(id)}`;
}

export function filePath(id: string, directoryId: string): string {
	const query = new URLSearchParams({ directory: directoryId });
	return `/files/${encodeURIComponent(id)}?${query}`;
}
