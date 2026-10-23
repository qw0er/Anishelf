import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Check, Errors } from "typebox/value";
import { parseDocument } from "yaml";
import { TranscodeProfilesFileSchema } from "../../../../contracts/schemas/transcode-profiles.js";
import { DomainError } from "../../../../shared/errors.js";
import { freeze } from "../../../../shared/policy.js";
import type { ProfileCatalogIssue } from "../../../../shared/profile-issue.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../domain/transcode-profiles.js";

export function parseTranscodeProfiles(source: string): TranscodeProfile[] {
	let value: unknown;
	try {
		const document = parseDocument(source);
		if (document.errors.length || document.warnings.length)
			throw new Error("Invalid YAML document.");
		value = document.toJS({ maxAliasCount: 100 });
	} catch {
		throw new DomainError(
			"CONFIG_INVALID",
			"transcode-profiles.yaml is not valid YAML.",
		);
	}
	if (!Check(TranscodeProfilesFileSchema, value)) {
		throw new DomainError(
			"CONFIG_INVALID",
			`Invalid transcode-profiles.yaml: ${JSON.stringify(Errors(TranscodeProfilesFileSchema, value))}`,
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

/** Startup snapshot. Missing files are normal; invalid custom files fall back to built-ins. */
export async function loadTranscodeProfiles(dataDir: string) {
	const path = join(dataDir, "transcode-profiles.yaml");
	let custom: TranscodeProfile[] = [];
	let issue: ProfileCatalogIssue | undefined;
	try {
		custom = parseTranscodeProfiles(await readFile(path, "utf8"));
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			if (!(cause instanceof DomainError) && code === undefined) throw cause;
			issue = {
				file: "transcode-profiles.yaml",
				detail: (cause instanceof DomainError
					? cause.message
					: "The file could not be read. Check its permissions."
				).slice(0, 2000),
			};
		}
	}
	return {
		profiles: freeze([...builtinTranscodeProfiles, ...custom]),
		...(issue ? { issue } : {}),
	};
}
