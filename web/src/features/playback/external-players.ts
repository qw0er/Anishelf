import { externalPlayerPolicy } from "../../config/external-player-policy.js";

export interface CustomExternalPlayer {
	id: string;
	name: string;
	template: string;
}

export function validPlayerTemplate(template: string): boolean {
	if (
		!template ||
		template.length > externalPlayerPolicy.maximumTemplateLength ||
		/\s/.test(template)
	)
		return false;
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(template)?.[1]?.toLowerCase();
	if (!scheme || externalPlayerPolicy.blockedSchemes.includes(scheme))
		return false;
	if (!template.includes("{url}") && !template.includes("{urlEncoded}"))
		return false;
	const remainder = template.replace(/\{(?:url|urlEncoded|mimeType)\}/g, "");
	if (
		/[{}]/.test(remainder) ||
		Array.from(template).some(
			(c) => (c.codePointAt(0) ?? 0) < 32 || c.codePointAt(0) === 127,
		)
	)
		return false;
	try {
		return (
			new URL(
				buildPlayerUrl(
					template,
					"https://example.test/api/media/file",
					"video/mp4",
				),
			).protocol === `${scheme}:`
		);
	} catch {
		return false;
	}
}

export function buildPlayerUrl(
	template: string,
	mediaUrl: string,
	mimeType: string,
): string {
	const media = new URL(mediaUrl);
	if (media.protocol !== "https:" && media.protocol !== "http:")
		throw new Error("Invalid media URL");
	const values: Record<string, string> = {
		url: media.href,
		urlEncoded: encodeURIComponent(media.href),
		mimeType: /^video\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : "video/*",
	};
	return template.replace(
		/\{(url|urlEncoded|mimeType)\}/g,
		(_, key: string) => values[key] ?? "",
	);
}

export function readCustomPlayers(
	storage: Pick<Storage, "getItem">,
): CustomExternalPlayer[] {
	const raw = storage.getItem(externalPlayerPolicy.storageKey);
	if (raw === null) return [];
	const data: unknown = JSON.parse(raw);
	if (
		!Array.isArray(data) ||
		data.length > externalPlayerPolicy.maximumCustomPlayers
	)
		throw new Error("Invalid external-player settings");
	const seen = new Set<string>();
	return data.map((entry: unknown) => {
		if (!entry || typeof entry !== "object")
			throw new Error("Invalid external-player settings");
		const item = entry as Record<string, unknown>;
		if (
			typeof item.id !== "string" ||
			!item.id.startsWith("custom:") ||
			seen.has(item.id) ||
			typeof item.name !== "string" ||
			!item.name.trim() ||
			item.name.length > externalPlayerPolicy.maximumNameLength ||
			typeof item.template !== "string" ||
			!validPlayerTemplate(item.template)
		)
			throw new Error("Invalid external-player settings");
		seen.add(item.id);
		return { id: item.id, name: item.name, template: item.template };
	});
}
