import path, { win32 } from "node:path";

export type PathRules = typeof win32;

export function relativePathParts(
	value: string,
	rules: PathRules = path,
): string[] | null {
	if (
		!value ||
		value.includes("\0") ||
		rules.isAbsolute(value) ||
		win32.isAbsolute(value)
	)
		return null;
	const windows = rules.sep === "\\";
	const parts = value.split(windows ? /[\\/]/ : "/");
	return parts.some(
		(part) =>
			!part ||
			part === "." ||
			part === ".." ||
			(windows && !isWindowsPathPart(part)),
	)
		? null
		: parts;
}

export function isWindowsPathPart(part: string): boolean {
	return (
		part.length > 0 &&
		!/[:<>"/\\|?*]/.test(part) &&
		![...part].some((char) => char.charCodeAt(0) < 32) &&
		!/[. ]$/.test(part) &&
		!/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]) *(?:\.|$)/i.test(part)
	);
}

export function isFullyQualifiedPath(
	value: string,
	rules: PathRules = path,
): boolean {
	if (!rules.isAbsolute(value) || value.includes("\0")) return false;
	if (rules.sep !== "\\") return true;
	const root = rules.parse(value).root;
	if (/^[a-z]:[\\/]$/i.test(root)) return true;
	const unc = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)[\\/]?$/.exec(root);
	return Boolean(
		unc?.[1] &&
			unc[2] &&
			isWindowsPathPart(unc[1]) &&
			isWindowsPathPart(unc[2]),
	);
}

/** The paths must use the same filesystem namespace. */
export function pathContains(
	root: string,
	candidate: string,
	rules: PathRules = path,
): boolean {
	const relative = rules.relative(root, candidate);
	return (
		!rules.isAbsolute(relative) &&
		relative !== ".." &&
		!relative.startsWith(`..${rules.sep}`)
	);
}
