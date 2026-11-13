import type { TranscodeProfileCatalog } from "@anishelf/contracts/http";
import type { SystemApi } from "../../public.js";
export function transcodeProfileCatalog(
	configuration: Pick<
		SystemApi,
		| "snapshot"
		| "transcodeProfiles"
		| "transcodeProfileIssue"
		| "transcodeRevision"
		| "transcodeValidation"
	>,
): TranscodeProfileCatalog {
	const selectedProfileId =
		configuration.snapshot.settings.defaultTranscodeProfileId;
	return {
		profiles: configuration.transcodeProfiles.map(
			({ id, name, description, container, video, audio }) => ({
				id,
				name,
				description,
				container,
				videoCodec: video.codec || (video.encoder === "copy" ? "copy" : null),
				audioCodec: audio.codec || (audio.encoder === "copy" ? "copy" : null),
				validation: configuration.transcodeValidation?.[id] ?? {
					status: "unverified",
					issues: [],
				},
				source: id.startsWith("builtin:") ? "builtin" : "custom",
			}),
		),
		selectedProfileId,
		revision: configuration.transcodeRevision ?? "uninitialized",
		selectionAvailable: configuration.transcodeProfiles.some(
			(profile) =>
				profile.id === selectedProfileId &&
				configuration.transcodeValidation?.[profile.id]?.status !==
					"unsupported",
		),
		...(configuration.transcodeProfileIssue
			? { issue: configuration.transcodeProfileIssue }
			: {}),
	};
}
