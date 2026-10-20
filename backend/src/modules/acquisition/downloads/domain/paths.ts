import { createHash } from "node:crypto";
import { posix } from "node:path";
import { workReference } from "../../../../shared/external-reference.js";
import { DownloadError } from "./model.js";
export function absoluteDownloadPath(value: string) {
	if (
		!value.startsWith("/") ||
		value.includes("\\") ||
		[...value].some((char) => char.charCodeAt(0) < 32) ||
		value.length > 2048 ||
		value.split("/").includes("..")
	)
		throw new DownloadError("invalid_destination");
	return posix.normalize(value).replace(/\/$/, "") || "/";
}
export function inside(path: string, root: string) {
	return path === root || path.startsWith(`${root === "/" ? "" : root}/`);
}
export function relativeDownloadPath(value: string) {
	if (
		!value ||
		value.length > 4096 ||
		value.includes("\\") ||
		[...value].some((char) => char.charCodeAt(0) < 32) ||
		value.split("/").some((part) => !part || part === "." || part === "..") ||
		posix.isAbsolute(value)
	)
		throw new DownloadError("invalid_file_path");
	return value;
}
export function workDirectory(key: string, title: string) {
	const reference = workReference(key);
	const safe = (value: string) =>
		value
			.normalize("NFC")
			.replace(/[<>:"/\\|?*]/g, "_")
			.split("")
			.map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
			.join("")
			.replace(/[ .]+$/g, "")
			.trim();
	const readable = [...safe(title || "Anime")].slice(0, 60).join("") || "Anime";
	const identity = safe(`${reference.provider}-${reference.id}`);
	const suffix =
		identity.length <= 60 &&
		/^[a-z0-9_]+$/i.test(reference.provider) &&
		/^[a-z0-9_]+$/i.test(reference.id) &&
		identity === `${reference.provider}-${reference.id}`
			? identity
			: `${identity.slice(0, 40)}-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
	let name = readable;
	while (Buffer.byteLength(`${name} [${suffix}]`, "utf8") > 240)
		name = [...name].slice(0, -1).join("");
	return `${name} [${suffix}]`;
}
