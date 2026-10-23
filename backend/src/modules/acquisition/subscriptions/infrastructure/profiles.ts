import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Check, Errors } from "typebox/value";
import { isAlias, LineCounter, parseDocument, visit } from "yaml";
import { DomainError } from "../../../../shared/errors.js";
import { freeze } from "../../../../shared/policy.js";
import {
	type AcquisitionProfile,
	AcquisitionProfilesFileSchema,
	builtinAcquisitionProfiles,
} from "../domain/profiles.js";

const filename = "acquisition-profiles.yaml";
export function parseAcquisitionProfiles(source: string): AcquisitionProfile[] {
	const fail = (message: string): never => {
		throw new DomainError("CONFIG_INVALID", `${filename}: ${message}`);
	};
	if (Buffer.byteLength(source) > 1024 * 1024) fail("File exceeds 1 MiB.");
	const lineCounter = new LineCounter();
	const document = parseDocument(source, {
		lineCounter,
		uniqueKeys: true,
		customTags: [],
	});
	if (document.errors.length || document.warnings.length)
		fail(
			[...document.errors, ...document.warnings]
				.map((error) => error.message)
				.join("; "),
		);
	visit(document, (_, node) => {
		if (isAlias(node))
			fail("Aliases are not supported; write each condition explicitly.");
	});
	const value: unknown = document.toJS({ maxAliasCount: 0 });
	if (!Check(AcquisitionProfilesFileSchema, value)) {
		const errors = [...Errors(AcquisitionProfilesFileSchema, value)];
		fail(
			errors
				.map((error) => {
					const path = error.instancePath
						.split("/")
						.slice(1)
						.map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
					const node = document.getIn(path, true) as
						| { range?: [number, number, number] }
						| undefined;
					const position = lineCounter.linePos(node?.range?.[0] ?? 0);
					return `${error.instancePath || "/"} at line ${position.line}, column ${position.col}: ${error.message}`;
				})
				.join("; "),
		);
	}
	const profiles = (value as { profiles: AcquisitionProfile[] }).profiles;
	const ids = new Set<string>();
	for (const profile of profiles) {
		if (!profile.id.startsWith("custom:") || ids.has(profile.id))
			fail(`Profile ${profile.id} must have a unique custom: ID.`);
		ids.add(profile.id);
		let previous = 0;
		for (const level of profile.levels) {
			if (level.acceptAfterMinutes < previous)
				fail(`Profile ${profile.id}: level wait times must not decrease.`);
			previous = level.acceptAfterMinutes;
			for (const condition of [
				profile.requirements,
				...("anyOf" in level.match ? level.match.anyOf : [level.match]),
			]) {
				if (
					condition?.unknownSeeders !== undefined &&
					condition.minSeeders === undefined
				)
					fail(`Profile ${profile.id}: unknownSeeders requires minSeeders.`);
			}
		}
	}
	return profiles;
}
export async function loadAcquisitionProfiles(dataDir: string) {
	let custom: AcquisitionProfile[] = [];
	try {
		custom = parseAcquisitionProfiles(
			await readFile(join(dataDir, filename), "utf8"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return freeze([...builtinAcquisitionProfiles, ...custom]);
}
