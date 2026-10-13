import type { Logger } from "pino";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { ResourceAccessApi } from "../../resources/public.js";
import type { MediaInspectionApi } from "../media-inspection/public.js";
import { SubtitleDiscoveryService } from "../subtitles/application/discovery.js";
import { SubtitleFontPreparation } from "../subtitles/application/font-preparation.js";
import { SubtitlePreparationApplication } from "../subtitles/application/subtitle-preparation.js";
import { SubtitleApplication } from "../subtitles/application/subtitles.js";
import {
	type SubtitleRuntimePolicy,
	subtitleRuntimePolicy,
} from "../subtitles/policy.js";
import type { SubtitleExtractor } from "../subtitles/ports.js";
import type { SubtitleStore } from "../subtitles/storage.js";

export function createSubtitleApplication(options: {
	logger?: Logger;
	sources: ResourceAccessApi;
	policy?: DeepReadonly<SubtitleRuntimePolicy>;
	inspection?: MediaInspectionApi;
	tools?: SubtitleExtractor;
	repository?: SubtitleStore;
	dataDir?: string;
}): SubtitleApplication {
	const logger = options.logger?.child({ module: "subtitles" });
	const policy = options.policy ?? subtitleRuntimePolicy;
	let fonts: SubtitleFontPreparation | undefined;
	let preparation: SubtitlePreparationApplication | undefined;
	if (options.repository && options.dataDir && options.tools?.extractSubtitle) {
		const dependencies = {
			dataDir: options.dataDir,
			repository: options.repository,
			sources: options.sources,
			tools: options.tools,
			...(logger ? { logger } : {}),
		};
		fonts = new SubtitleFontPreparation({
			...dependencies,
			policy: policy.subtitles,
		});
		preparation = new SubtitlePreparationApplication({
			...dependencies,
			policy,
			tools: {
				extractSubtitle: options.tools.extractSubtitle.bind(options.tools),
			},
		});
	}
	return new SubtitleApplication({
		sources: options.sources,
		policy,
		discovery: new SubtitleDiscoveryService({
			sources: options.sources,
			policy,
			...(options.inspection ? { inspection: options.inspection } : {}),
			...(logger ? { logger } : {}),
		}),
		...(logger ? { logger } : {}),
		...(fonts ? { fonts } : {}),
		...(preparation ? { preparation } : {}),
	});
}
