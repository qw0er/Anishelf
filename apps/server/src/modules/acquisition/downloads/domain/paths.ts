import { createHash } from "node:crypto";
import { workReference } from "@anishelf/contracts/references";
import { DownloadError } from "./model.js";

export const maximumDownloadFilePathLength = 4096;

export function isDownloadPathPart(part: string): boolean {
	return (
		part.length > 0 &&
		part !== "." &&
		part !== ".." &&
		!/[\\/]/.test(part) &&
		![...part].some((char) => char.charCodeAt(0) < 32)
	);
}

export function relativeDownloadPath(value: string) {
	if (
		value.length > maximumDownloadFilePathLength ||
		!value.split("/").every(isDownloadPathPart)
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
