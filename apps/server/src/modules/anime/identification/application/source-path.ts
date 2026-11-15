import { sep } from "node:path";
import { relativePathParts } from "../../../../platform/paths.js";
import type { IdentificationSourcePath } from "../ports.js";

export function identificationSourcePath(
	relativePath: string,
): IdentificationSourcePath | null {
	if (sep === "/" && relativePath.includes("\\")) return null;
	const ancestors = relativePathParts(relativePath);
	const filename = ancestors?.pop();
	return filename && ancestors ? { relativePath, filename, ancestors } : null;
}
