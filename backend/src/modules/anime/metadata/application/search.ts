import type { Logger } from "pino";
import {
	type CachedMetadata,
	MetadataError,
	type Page,
	type ReadOptions,
	type SearchRequest,
	type WorkSummary,
} from "../domain/model.js";
import { projectSummary } from "../domain/projection.js";
import type * as Source from "../domain/source-model.js";
import type { SourceMetadataApi } from "../ports.js";
import type { MetadataIdentities } from "./identities.js";
import { collectMetadata } from "./operations.js";
import { combineResults } from "./results.js";
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
	) {}
	async search(request: SearchRequest, options: ReadOptions = {}) {
		const page = request.page ?? 1,
			perPage = request.perPage ?? 10;
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			!Number.isSafeInteger(perPage) ||
			perPage < 1 ||
			perPage > 50 ||
			page * perPage > 500
		)
			throw new MetadataError({
				code: "invalid-request",
				message:
					"Search supports a window of 500 results and pages of 1–50 items.",
				retryAt: null,
			});
		const limit = page * perPage;
		const { values, failed } = await collectMetadata(
			this.source.providers().map((provider) => async () => {
				const pages: CachedMetadata<Page<Source.WorkSummary>>[] = [];
				for (let index = 1; index <= Math.ceil(limit / 50); index++) {
					const result = await this.source.search(
						{
							query: request.query,
							provider: provider.key,
							page: index,
							perPage: 50,
						},
						options,
					);
					pages.push(result);
					if (!result.data.hasNextPage) break;
				}
				return combineResults(pages, {
					items: pages.flatMap((value) => value.data.items),
					hasNextPage: pages.at(-1)?.data.hasNextPage ?? false,
				});
			}),
			options.signal,
			this.logger,
		);
		const unique = new Map<string, WorkSummary>();
		for (
			let i = 0;
			i < Math.max(0, ...values.map((value) => value.data.items.length));
			i++
		)
			for (const value of values) {
				const work = value.data.items[i];
				if (!work) continue;
				const projected = projectSummary(
					work,
					this.identities.referenceForExternal(work.reference),
				);
				if (!unique.has(projected.reference.id))
					unique.set(projected.reference.id, projected);
			}
		const items = [...unique.values()];
		this.logger?.debug(
			{
				event: "metadata.search_combined",
				sources: values.length,
				results: items.length,
				partial: failed,
			},
			"Project metadata search combined.",
		);
		return this.snapshots.save(
			"search",
			combineResults(
				values,
				{
					items: items.slice((page - 1) * perPage, limit),
					page,
					perPage,
					hasNextPage:
						limit < 500 &&
						(items.length > limit ||
							values.some((value) => value.data.hasNextPage)),
				},
				failed,
			),
		);
	}
}
