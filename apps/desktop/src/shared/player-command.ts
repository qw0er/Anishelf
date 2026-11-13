import type { CommandPlayerDraft } from "../ipc/desktop.js";

export type {
	CommandPlayerConfig,
	CommandPlayerDraft,
	CommandPlayerPreset,
	ExternalPlayerListResponse,
} from "../ipc/desktop.js";

const commandPlayerLimits = {
	maximumNameLength: 80,
	maximumExecutableLength: 4096,
	maximumArguments: 32,
	maximumArgumentLength: 2048,
	maximumTotalArgumentLength: 8192,
} as const;

const placeholderPattern = /\{(url|urlEncoded|mimeType)\}/g;
const valuePlaceholders = /\{(?:url|urlEncoded|mimeType)\}/g;
const urlPlaceholders = /\{(?:url|urlEncoded)\}/;
const videoMimeType = /^video\/[a-z0-9.+-]+$/i;

function hasControlCharacters(value: string): boolean {
	return Array.from(value).some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127;
	});
}

/**
 * Validate a command player before it is persisted or executed.
 *
 * This is intentionally pure so the renderer can show the same errors the main
 * process enforces. The main process additionally checks the executable file.
 */
export function validateCommandPlayer(
	draft: CommandPlayerDraft,
): string | null {
	const invalid = "externalPlayers.invalidCommand";
	const name = draft.name.trim();
	const executable = draft.executable.trim();
	if (
		!name ||
		name.length > commandPlayerLimits.maximumNameLength ||
		!executable ||
		executable.length > commandPlayerLimits.maximumExecutableLength ||
		hasControlCharacters(executable)
	)
		return invalid;
	if (
		!Array.isArray(draft.args) ||
		draft.args.length > commandPlayerLimits.maximumArguments
	)
		return invalid;
	let totalLength = 0;
	for (const argument of draft.args) {
		if (
			typeof argument !== "string" ||
			argument.length > commandPlayerLimits.maximumArgumentLength ||
			hasControlCharacters(argument) ||
			/[{}]/.test(argument.replace(valuePlaceholders, ""))
		)
			return invalid;
		totalLength += argument.length;
	}
	if (totalLength > commandPlayerLimits.maximumTotalArgumentLength)
		return invalid;
	if (!draft.args.some((argument) => urlPlaceholders.test(argument)))
		return invalid;
	return null;
}

export interface PlayerMedia {
	url: string;
	mimeType: string;
}

export function substituteCommandArgs(
	args: readonly string[],
	media: PlayerMedia,
): string[] {
	const url = new URL(media.url);
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password
	)
		throw new Error("Invalid media URL");
	const values: Record<string, string> = {
		url: url.href,
		urlEncoded: encodeURIComponent(url.href),
		mimeType: videoMimeType.test(media.mimeType) ? media.mimeType : "video/*",
	};
	return args.map((argument) =>
		argument.replace(placeholderPattern, (_, key: string) => values[key] ?? ""),
	);
}

/** Remove the access token from a URL before previewing or logging it. */
export function maskMediaUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.searchParams.has("access_token"))
			url.searchParams.set("access_token", "***");
		return url.href;
	} catch {
		return value;
	}
}

function quoteArgument(value: string): string {
	if (value && /^[A-Za-z0-9_./:=@%+{}-]+$/.test(value)) return value;
	return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/** Human-readable command preview. This is never passed to a shell. */
export function formatCommand(
	executable: string,
	args: readonly string[],
): string {
	return [executable, ...args].map(quoteArgument).join(" ");
}
