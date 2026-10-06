import type { QueryClient } from "@tanstack/react-query";
import { ApiClientError, type RequestOptions } from "../../api/client.js";
import { fileQuery } from "../../api/queries.js";
import { loadQuery, queryClient } from "../../api/query-client.js";

/** Recheck access and accept only the original-media route for the selected file. */
async function resolveMediaLink(
	fileId: string,
	origin: string,
	options?: RequestOptions,
	client: QueryClient = queryClient,
	scope = "",
) {
	const file = await loadQuery(
		{ ...fileQuery(fileId, scope), staleTime: 0 },
		options?.signal ?? new AbortController().signal,
		client,
	);
	const expectedPath = `/api/media/${encodeURIComponent(fileId)}`;
	if (file.file.id !== fileId || file.originalMediaUrl !== expectedPath) {
		throw new ApiClientError({
			kind: "invalid_response",
			message: "The server returned an invalid media link. Please retry.",
		});
	}
	return {
		url: new URL(file.originalMediaUrl, origin).href,
		name: file.file.name,
	};
}

export async function createMediaLink(
	fileId: string,
	origin: string,
	options?: RequestOptions,
	client: QueryClient = queryClient,
	scope = "",
): Promise<string> {
	return (await resolveMediaLink(fileId, origin, options, client, scope)).url;
}

export async function createMediaPlaylist(
	fileId: string,
	origin: string,
	options?: RequestOptions,
	client: QueryClient = queryClient,
	scope = "",
) {
	const { url, name } = await resolveMediaLink(
		fileId,
		origin,
		options,
		client,
		scope,
	);
	// Metadata must occupy one line, even when the source filename contains newlines.
	const title = Array.from(name, (character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127 ? " " : character;
	}).join("");
	const filename = title.replace(/[<>:"/\\|?*]/g, "_").slice(0, 160) || "media";
	return {
		content: `#EXTM3U\n#EXTINF:-1,${title}\n${url}\n`,
		filename: `${filename}.m3u`,
	};
}
