import type { Logger } from "pino";
import type { ReadOptions, SearchRequest } from "../domain/model.js";
import { projectSummary } from "../domain/projection.js";
import type { SourceMetadataApi } from "../ports.js";
import type { MetadataIdentities } from "./identities.js";
import type { MetadataNameEnrichment } from "./name-enrichment.js";
import { projectEnvelope, projectPage } from "./results.js";
import type { MetadataSnapshots } from "./snapshots.js";
export class MetadataSearch {
	constructor(
		private readonly source: Pick<SourceMetadataApi, "providers" | "search">,
		private readonly identities: Pick<
			MetadataIdentities,
			"referenceForExternal"
		>,
		private readonly snapshots: Pick<MetadataSnapshots, "save">,
		private readonly logger?: Logger,
		private readonly defaultProvider: () => string = () =>
			this.source.providers()[0]?.key ?? "",
		private readonly names?: MetadataNameEnrichment,
	) {}
	async search(request: SearchRequest, options: ReadOptions = {}) {
		const provider = request.provider ?? this.defaultProvider();
		const result = await this.source.search({ ...request, provider }, options);
		const items = await Promise.all(
			result.data.items.map(async (work) =>
				this.names
					? (await this.names.enrich({ ...result, data: work }, options)).data
					: work,
			),
		);
		this.logger?.debug(
			{
				event: "metadata.search_completed",
				provider,
				results: result.data.items.length,
			},
			"Single-source metadata search completed.",
		);
		return this.snapshots.save(
			"search",
			projectEnvelope({ ...result, data: { ...result.data, items } }, (data) =>
				projectPage(data, (work) =>
					projectSummary(
						work,
						this.identities.referenceForExternal(work.reference),
					),
				),
			),
		);
	}
}
