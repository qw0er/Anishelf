import {
	type DeepReadonly,
	freeze,
	requirePolicy,
} from "../../../shared/policy.js";

const defaults = {
	videoMimeTypes: {
		".mp4": "video/mp4",
		".m4v": "video/mp4",
		".webm": "video/webm",
		".mkv": "video/x-matroska",
	} as Record<string, string>,
};
export type ResourceAccessPolicy = typeof defaults;
export const resourceAccessPolicy = freeze(defaults);
export function validateResourceAccessPolicy(
	policy: DeepReadonly<ResourceAccessPolicy>,
): void {
	for (const [extension, mime] of Object.entries(policy.videoMimeTypes))
		requirePolicy(
			resourceAccessPolicy.videoMimeTypes[extension] === mime,
			`resourceAccess.videoMimeTypes.${extension}`,
		);
}
