import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Check, Errors } from "typebox/value";
import { TranscodeProfilesFileSchema } from "../../../contracts/schemas/transcode-profiles.js";
import { DomainError } from "../../../shared/errors.js";
import { freeze } from "../../../shared/policy.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../domain/transcode-profiles.js";

export function parseTranscodeProfiles(source: string): TranscodeProfile[] {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		throw new DomainError(
			"CONFIG_INVALID",
			"transcode-profiles.json is not valid JSON.",
		);
	}
	if (!Check(TranscodeProfilesFileSchema, value)) {
		throw new DomainError(
			"CONFIG_INVALID",
			`Invalid transcode-profiles.json: ${JSON.stringify(Errors(TranscodeProfilesFileSchema, value))}`,
		);
	}
	const ids = new Set<string>();
	for (const profile of value.profiles) {
		if (!profile.id.startsWith("custom:") || ids.has(profile.id))
			throw new DomainError(
				"CONFIG_INVALID",
				`Profile ${profile.id} must have a unique custom: ID; built-in profiles cannot be overridden.`,
			);
		ids.add(profile.id);
	}
	return value.profiles;
}

/** Startup snapshot. Missing external file is normal; malformed files fail startup. */
export async function loadTranscodeProfiles(dataDir: string) {
	const path = join(dataDir, "transcode-profiles.json");
	let custom: TranscodeProfile[];
	try {
		custom = parseTranscodeProfiles(await readFile(path, "utf8"));
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") custom = [];
		else if (cause instanceof DomainError) throw cause;
		else
			throw new DomainError(
				"CONFIG_INVALID",
				`Cannot read ${path}. Check the file permissions.`,
				{ cause },
			);
	}
	return freeze([...builtinTranscodeProfiles, ...custom]);
}
