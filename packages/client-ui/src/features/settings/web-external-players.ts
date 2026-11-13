import type {
	ClientPlatform,
	ExternalPlayerCatalog,
	ExternalPlayerDraft,
	ExternalPlayerHost,
	PlayerMedia,
	UrlTemplatePlayer,
} from "../../shared/platform.js";
import {
	detectClientPlatform,
	externalPlayerPolicy,
	presetsForPlatform,
} from "./external-player-policy.js";

export interface CustomExternalPlayer {
	id: string;
	name: string;
	template: string;
}

function toPlayer(player: {
	id: string;
	name: string;
	template: string;
}): UrlTemplatePlayer {
	return {
		kind: "url-template",
		id: player.id,
		name: player.name,
		template: player.template,
	};
}

/**
 * Browser-backed external players: presets filtered by the client platform plus
 * custom URL templates stored in this origin's preferences.
 */
export function createBrowserExternalPlayers(
	platform: Pick<
		ClientPlatform,
		"preferences" | "device" | "onPreferenceChange"
	>,
	open: (url: string) => void,
): ExternalPlayerHost {
	function list(): ExternalPlayerCatalog {
		const presets = presetsForPlatform(
			detectClientPlatform(platform.device),
		).map(toPlayer);
		try {
			return {
				presets,
				custom: readCustomPlayers(platform.preferences).map(toPlayer),
				error: false,
			};
		} catch {
			return { presets, custom: [], error: true };
		}
	}

	function validate(draft: ExternalPlayerDraft): string | null {
		if (draft.kind !== "url-template") return "externalPlayers.invalidTemplate";
		const name = draft.name.trim();
		const template = draft.template.trim();
		if (
			!name ||
			name.length > externalPlayerPolicy.maximumNameLength ||
			!validPlayerTemplate(template)
		)
			return "externalPlayers.invalidTemplate";
		return null;
	}

	async function add(draft: ExternalPlayerDraft) {
		if (draft.kind !== "url-template" || validate(draft))
			throw new Error("Invalid player");
		const current = readCustomPlayers(platform.preferences);
		if (current.length >= externalPlayerPolicy.maximumCustomPlayers)
			throw new Error("Too many players");
		platform.preferences.setItem(
			externalPlayerPolicy.storageKey,
			JSON.stringify([
				...current,
				{
					id: `custom:${crypto.randomUUID()}`,
					name: draft.name.trim(),
					template: draft.template.trim(),
				},
			]),
		);
	}

	async function remove(id: string) {
		platform.preferences.setItem(
			externalPlayerPolicy.storageKey,
			JSON.stringify(
				readCustomPlayers(platform.preferences).filter(
					(player) => player.id !== id,
				),
			),
		);
	}

	return {
		mode: "url-template",
		list,
		validate,
		add,
		remove,
		describe: (player) =>
			player.kind === "url-template" ? player.template : "",
		link(player, media: PlayerMedia) {
			return player.kind === "url-template"
				? buildPlayerUrl(player.template, media.url, media.mimeType)
				: undefined;
		},
		async launch(player, media: PlayerMedia) {
			if (player.kind !== "url-template") return;
			console.debug("platform.external_player_requested", {
				playerId: player.id,
			});
			open(buildPlayerUrl(player.template, media.url, media.mimeType));
		},
		subscribe(listener) {
			return platform.onPreferenceChange(
				externalPlayerPolicy.storageKey,
				listener,
			);
		},
	};
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
