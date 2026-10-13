import type { TranscodeProfileCatalog } from "../../../../contracts/http.js";
import type { SystemApi } from "../../public.js";
export function transcodeProfileCatalog(
	configuration: Pick<SystemApi, "snapshot" | "transcodeProfiles">,
): TranscodeProfileCatalog {
	const selectedProfileId =
		configuration.snapshot.settings.defaultTranscodeProfileId;
	return {
		profiles: configuration.transcodeProfiles.map(
			({ id, name, description, usage, container, video, audio }) => ({
				id,
				name,
				description,
				container,
				videoEncoder: video.encoder,
				audioEncoder: audio.encoder,
				usage,
				source: id.startsWith("builtin:") ? "builtin" : "custom",
			}),
		),
		selectedProfileId,
		preparationMode: configuration.snapshot.settings.preparationMode,
		selectionAvailable: configuration.transcodeProfiles.some(
			(profile) => profile.id === selectedProfileId,
		),
	};
}
