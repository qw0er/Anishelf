import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Check } from "typebox/value";
import { parseDocument } from "yaml";
import { AutoPreparationFileSchema } from "../../../../contracts/schemas/auto-preparation.js";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import { freeze } from "../../../../shared/policy.js";
import type { ProfileCatalogIssue } from "../../../../shared/profile-issue.js";
import {
	type AutoPreparationPreset,
	builtinAutoPreparationPresets,
} from "../domain/auto-preparation.js";
import type { TranscodeProfile } from "../profile.js";

export function parseAutoPreparationPresets(
	source: string,
	profiles: DeepReadonly<TranscodeProfile[]>,
): AutoPreparationPreset[] {
	const document = parseDocument(source);
	if (document.errors.length || document.warnings.length)
		throw new DomainError(
			"CONFIG_INVALID",
			"Invalid auto-preparation-presets.yaml.",
		);
	const value: unknown = document.toJS({ maxAliasCount: 100 });
	if (!Check(AutoPreparationFileSchema, value))
		throw new DomainError(
			"CONFIG_INVALID",
			"Invalid auto-preparation preset fields.",
		);
	const ids = new Set<string>();
	for (const preset of value.presets ?? []) {
		if (!preset.id.startsWith("custom:") || ids.has(preset.id))
			throw new DomainError(
				"CONFIG_INVALID",
				"Preset IDs must be unique custom: IDs.",
			);
		ids.add(preset.id);
		const profile = profiles.find((p) => p.id === preset.transcodeProfileId);
		if (!profile)
			throw new DomainError(
				"CONFIG_INVALID",
				`Unknown transcode profile: ${preset.transcodeProfileId}.`,
			);
		if (
			preset.audio?.selection === "languages" &&
			!preset.audio.languages?.length
		)
			throw new DomainError(
				"CONFIG_INVALID",
				"Language selection requires languages.",
			);
		for (const candidate of [
			...(preset.accept?.video ?? []),
			...(preset.accept?.audio ?? []),
		]) {
			if (
				(candidate.profiles?.length ||
					("maxLevel" in candidate && candidate.maxLevel != null)) &&
				candidate.codecs?.length !== 1
			)
				throw new DomainError(
					"CONFIG_INVALID",
					"Profile/level constraints require exactly one codec.",
				);
		}
		if (
			preset.accept?.containers?.length &&
			!preset.accept.containers.includes(profile.container)
		)
			throw new DomainError(
				"CONFIG_INVALID",
				"Output container is rejected by the preset.",
			);

		for (const [candidates, encoding] of [
			[preset.accept?.video, profile.video],
			[preset.accept?.audio, profile.audio],
		] as const) {
			if (
				encoding.encoder !== "copy" &&
				encoding.codec &&
				candidates?.length &&
				!candidates.some(
					(c) => !c.codecs?.length || c.codecs.includes(encoding.codec),
				)
			)
				throw new DomainError(
					"CONFIG_INVALID",
					"Output codec is rejected by the preset.",
				);
		}
	}
	return value.presets ?? [];
}
export async function loadAutoPreparationPresets(
	dataDir: string,
	profiles: DeepReadonly<TranscodeProfile[]>,
) {
	let custom: AutoPreparationPreset[] = [];
	let issue: ProfileCatalogIssue | undefined;
	try {
		custom = parseAutoPreparationPresets(
			await readFile(join(dataDir, "auto-preparation-presets.yaml"), "utf8"),
			profiles,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			issue = {
				file: "auto-preparation-presets.yaml",
				detail:
					error instanceof DomainError
						? error.message
						: "The preset file could not be loaded. Check YAML syntax and file permissions.",
			};
	}
	return {
		presets: freeze([...builtinAutoPreparationPresets, ...custom]),
		issue,
	};
}
