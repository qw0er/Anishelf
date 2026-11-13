import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TranscodeProfilesFileSchema } from "@anishelf/contracts/schemas/transcode-profiles";
import { Check, Errors } from "typebox/value";
import { parseDocument } from "yaml";
import {
	validateEncodingOptions,
	validEncodingOptions,
} from "../../../../platform/media/encoding-policy.js";
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
	if (
		value &&
		typeof value === "object" &&
		"version" in value &&
		value.version !== 2
	)
		throw new DomainError(
			"CONFIG_INVALID",
			"Only transcode profile version 2 is supported. Migrate the old file using the transcode profiles guide.",
		);
	if (!Check(TranscodeProfilesFileSchema, value)) {
		throw new DomainError(
			"CONFIG_INVALID",
			`Invalid transcode-profiles.yaml: ${JSON.stringify(
				Errors(TranscodeProfilesFileSchema, value)
					.slice(0, 20)
					.map((error) => ({
						field: error.instancePath,
						message: error.message,
					})),
			)}`,
		);
	}
	const ids = new Set<string>();
	for (const profile of value.profiles) {
		try {
			validateEncodingOptions(profile.globalOptions, "global");
			validateEncodingOptions(profile.inputOptions, "input");
			validateEncodingOptions(profile.muxerOptions, "muxer");
		} catch (error) {
			throw new DomainError(
				"CONFIG_INVALID",
				error instanceof Error ? error.message : "Invalid options.",
			);
		}
		if (!profile.id.startsWith("custom:") || ids.has(profile.id))
			throw new DomainError(
				"CONFIG_INVALID",
				`Profile ${profile.id} must have a unique custom: ID; built-in profiles cannot be overridden.`,
			);
		if (
			!validEncodingOptions(
				{ ...profile.video, codec: profile.video.codec ?? "" },
				{ ...profile.audio, codec: profile.audio.codec ?? "" },
			)
		)
			throw new DomainError(
				"CONFIG_INVALID",
				`Unsupported encoder options in ${profile.id}.`,
			);
		ids.add(profile.id);
	}
	return value.profiles.map((profile) => ({
		...profile,
		video: { ...profile.video, codec: profile.video.codec ?? "" },
		audio: { ...profile.audio, codec: profile.audio.codec ?? "" },
	}));
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
