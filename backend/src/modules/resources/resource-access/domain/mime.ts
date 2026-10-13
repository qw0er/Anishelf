import { extname } from "node:path";
import { resourceAccessPolicy } from "../policy.js";
export function getVideoMimeType(
	path: string,
	types: Readonly<Record<string, string>> = resourceAccessPolicy.videoMimeTypes,
): string | null {
	return types[extname(path).toLowerCase()] ?? null;
}
