import type { QueryClient } from "@tanstack/react-query";
import { ApiClientError, type RequestOptions } from "../../api/client.js";
import { fileQuery } from "../../api/queries.js";
import { loadQuery, queryClient } from "../../api/query-client.js";

/** Recheck access and accept only the original-media route for the selected file. */
export async function createMediaLink(
	fileId: string,
	origin: string,
	options?: RequestOptions,
	client: QueryClient = queryClient,
	scope = "",
): Promise<string> {
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
	return new URL(file.originalMediaUrl, origin).href;
}
