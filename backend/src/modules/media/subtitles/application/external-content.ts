import { dirname, join } from "node:path";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type {
	FileSourceIdentity,
	ResolvedSource,
	ResourceAccessApi,
	ResourceFiles,
} from "../../../resources/public.js";
import type { ExternalSubtitle } from "../domain/model.js";
import { readSubtitleText } from "../infrastructure/content.js";
import type { SubtitleRuntimePolicy } from "../policy.js";

export async function readExternalSubtitle(
	sources: ResourceAccessApi,
	policy: DeepReadonly<SubtitleRuntimePolicy>,
	source: ResolvedSource,
	track: ExternalSubtitle,
	resources: ResourceFiles,
): Promise<{ text: string }> {
	const identity: FileSourceIdentity = {
		canonicalRoot: source.identity.canonicalRoot,
		relativePath: join(dirname(source.identity.relativePath), track.name),
		sourceVersion: track.sourceVersion,
	};
	sources.assertRootEpoch(source.rootEpoch);
	let text: string;
	try {
		const file = await resources.openSubtitleSource(identity);
		try {
			text = await readSubtitleText(
				file,
				policy.subtitles.maximumBytes,
				policy.subtitles.readChunkBytes,
			);
		} finally {
			await file.release();
		}
		await resources.revalidateSubtitleSource(identity);
	} catch (error) {
		sources.assertRootEpoch(source.rootEpoch);
		throw error;
	}
	await sources.revalidateSource(source);
	return { text };
}
