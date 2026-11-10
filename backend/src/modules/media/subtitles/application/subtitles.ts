import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { ResourceAccessApi } from "../../../resources/public.js";
import { assertSourceVersion } from "../../../resources/public.js";
import { discoverExternalSubtitles } from "../infrastructure/discovery.js";
import type { SubtitleRuntimePolicy } from "../policy.js";
import { readExternalSubtitle } from "./external-content.js";
export class SubtitleApplication {
	private readonly sources: ResourceAccessApi;
	private readonly policy: DeepReadonly<SubtitleRuntimePolicy>;
	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			policy: DeepReadonly<SubtitleRuntimePolicy>;
			logger?: Logger;
		},
	) {
		this.sources = options.sources;
		this.policy = options.policy;
	}
	async discoverSubtitles(id: string) {
		const source = await this.sources.resolveSource(id);
		const resources = await this.sources.openResources(source);
		const result = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			source.identity.sourceVersion,
			this.policy.subtitles,
			this.policy.library,
		);
		await this.sources.revalidateSource(source);
		this.sources.assertAccessRevision(source.accessRevision);
		this.options.logger?.debug(
			{
				event: "subtitles.sidecars_discovered",
				fileId: id,
				count: result.tracks.length,
			},
			"External subtitles discovered.",
		);
		return result;
	}

	async getSubtitleContent(
		id: string,
		trackId: string,
		sourceVersion: string,
		subtitleVersion: string,
	): Promise<{ text: string }> {
		const source = await this.sources.resolveSource(id, sourceVersion);
		const resources = await this.sources.openResources(source);
		const discovered = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			sourceVersion,
			this.policy.subtitles,
			this.policy.library,
		);
		this.sources.assertAccessRevision(source.accessRevision);
		const track = discovered.tracks.find(
			(candidate) => candidate.id === trackId,
		);
		if (!track)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"The subtitle is unavailable. Refresh the subtitle list.",
			);
		assertSourceVersion(subtitleVersion, track.sourceVersion);
		return readExternalSubtitle(
			this.sources,
			this.policy,
			source,
			track,
			resources,
		);
	}
}
