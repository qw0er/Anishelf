import {
	ApiClientError,
	getFile,
	type RequestOptions,
} from "../../api/client.js";

/** Recheck access and accept only the original-media route for the selected file. */
export async function createMediaLink(
	fileId: string,
	origin: string,
	options?: RequestOptions,
): Promise<string> {
	const file = await getFile(fileId, options);
	const expectedPath = `/api/media/${encodeURIComponent(fileId)}`;
	if (file.file.id !== fileId || file.playbackUrl !== expectedPath) {
		throw new ApiClientError({
			kind: "invalid_response",
			message: "The server returned an invalid media link. Please retry.",
		});
	}
	return new URL(file.playbackUrl, origin).href;
}
