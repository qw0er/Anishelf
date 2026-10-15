import type { QueryClient } from "@tanstack/react-query";
import {
	ApiClientError,
	type RequestOptions,
} from "../../../shared/api/client.js";
import { loadQuery, queryClient } from "../../../shared/api/query-client.js";
import { fileQuery } from "../../resources/public.js";
import { createMediaAccessLink } from "./api.js";

/** Recheck access and accept only the original-media route for the selected file. */
export async function resolveMediaLink(
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
	const link = await createMediaAccessLink(fileId, options);
	const resolved = new URL(link.url, origin);
	if (
		resolved.origin !== new URL(origin).origin ||
		resolved.pathname !== expectedPath ||
		!resolved.searchParams.get("access_token")
	)
		throw new ApiClientError({
			kind: "invalid_response",
			message: "The server returned an invalid media link.",
		});
	return {
		url: resolved.href,
		name: file.file.name,
		mimeType: file.file.mimeType ?? "video/*",
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
