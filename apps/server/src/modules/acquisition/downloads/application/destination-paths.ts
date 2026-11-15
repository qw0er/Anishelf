import path from "node:path";
import {
	isFullyQualifiedPath,
	isWindowsPathPart,
	type PathRules,
} from "../../../../platform/paths.js";
import { DownloadError } from "../domain/model.js";

export function absoluteDownloadPath(value: string, rules: PathRules = path) {
	const windows = rules.sep === "\\";
	const root = rules.parse(value).root;
	const parts = value.slice(root.length).split(windows ? /[\\/]/ : "/");
	if (
		!isFullyQualifiedPath(value, rules) ||
		(!windows && value.includes("\\")) ||
		[...value].some((char) => char.charCodeAt(0) < 32) ||
		value.length > 2048 ||
		parts.some(
			(part) =>
				part === ".." ||
				(windows && part !== "" && part !== "." && !isWindowsPathPart(part)),
		)
	)
		throw new DownloadError("invalid_destination");
	const normalized = rules.normalize(value);
	return normalized === rules.parse(normalized).root ||
		!normalized.endsWith(rules.sep)
		? normalized
		: normalized.slice(0, -1);
}
export function sameDownloadPath(
	first: string,
	second: string,
	rules: PathRules = path,
) {
	return (
		rules.relative(
			absoluteDownloadPath(first, rules),
			absoluteDownloadPath(second, rules),
		) === ""
	);
}
