export function directoryPath(id: string): string {
	return id === "root"
		? "/directories/root"
		: `/directories/${encodeURIComponent(id)}`;
}

export function filePath(id: string, directoryId: string): string {
	const query = new URLSearchParams({ directory: directoryId });
	return `/files/${encodeURIComponent(id)}?${query}`;
}

/** Only the local poster wall can be supplied as a return destination. */
export function libraryReturnPath(value: string | null): string {
	if (!value || !/^\/(?:\?[^#]*)?$/.test(value)) return "/";
	return value;
}
export function animePlayerPath(
	fileId: string,
	workId: string,
	episodeId: string,
	library: string,
	sourceVersion: string,
): string {
	return `/files/${encodeURIComponent(fileId)}?${new URLSearchParams({ anime: workId, episode: episodeId, library: libraryReturnPath(library), version: sourceVersion })}`;
}
export function animeReturnPath(params: URLSearchParams): string | null {
	const work = params.get("anime");
	if (!work) return null;
	const episode = params.get("episode");
	const query = new URLSearchParams({
		library: libraryReturnPath(params.get("library")),
	});
	return `/anime/${encodeURIComponent(work)}?${query}${episode ? `#episode-${encodeURIComponent(episode)}` : ""}`;
}
