import { sep } from "node:path";
import type { IdentificationSourcePath } from "@anishelf/anime-identification";
import { relativePathParts } from "../../../../platform/paths.js";

export function identificationSourcePath(
	relativePath: string,
): IdentificationSourcePath | null {
	if (sep === "/" && relativePath.includes("\\")) return null;
	const ancestors = relativePathParts(relativePath);
	const filename = ancestors?.pop();
	return filename && ancestors ? { relativePath, filename, ancestors } : null;
}
