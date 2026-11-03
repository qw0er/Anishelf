import type { Logger } from "pino";
import type { ReadOptions, SearchRequest } from "../domain/model.js";
import { projectSummary } from "../domain/projection.js";
import type { SourceMetadataApi } from "../ports.js";
import type { MetadataIdentities } from "./identities.js";
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
	) {}
	async search(request: SearchRequest, options: ReadOptions = {}) {
		const provider = request.provider ?? this.defaultProvider();
		const result = await this.source.search({ ...request, provider }, options);
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
			projectEnvelope(result, (data) =>
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
