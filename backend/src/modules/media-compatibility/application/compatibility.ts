import type { Logger } from "pino";
import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
	CompatibilityResult,
} from "../../../contracts/http.js";
import { MediaToolError } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import {
	type MediaInspectionApi,
	MediaInspectionBusyError,
} from "../../media-inspection/public.js";
import type { ResourceAccessApi } from "../../resource-access/public.js";
import { planCompatibility } from "../domain/planner.js";
import { describeCompatibility } from "./description.js";
export class MediaCompatibilityApplication {
	constructor(
		private readonly options: {
			inspection: MediaInspectionApi;
			sources: ResourceAccessApi;
			logger?: Logger;
		},
	) {}
	private async load(fileId: string, sourceVersion?: string) {
		try {
			const { source, info } = await this.options.inspection.inspect(
				fileId,
				sourceVersion,
			);
			return { source, info };
		} catch (error) {
			if (
				error instanceof MediaInspectionBusyError ||
				error instanceof MediaToolError
			)
				throw new DomainError(
					"MEDIA_INSPECTION_UNAVAILABLE",
					"Media inspection could not be completed. Retry.",
					{ cause: error },
				);
			throw error;
		}
	}
	async inspect(
		fileId: string,
		sourceVersion?: string,
	): Promise<CompatibilityInspection> {
		const { source, info } = await this.load(fileId, sourceVersion);
		return describeCompatibility(fileId, source.identity.sourceVersion, info);
	}
	async check(
		fileId: string,
		input: CompatibilityCheckRequest,
	): Promise<CompatibilityResult> {
		const { source, info } = await this.load(fileId, input.sourceVersion);
		const description = describeCompatibility(
			fileId,
			source.identity.sourceVersion,
			info,
		);
		const ids = new Set(description.queries.map((q) => q.id));
		const seen = new Set<string>();
		for (const e of input.evidence) {
			if (
				!ids.has(e.id) ||
				seen.has(e.id) ||
				(e.status === "supported" && e.reason !== "browser-supported") ||
				(e.status === "unsupported" && e.reason !== "browser-rejected") ||
				(e.status === "unknown" &&
					["browser-supported", "browser-rejected"].includes(e.reason))
			)
				throw new DomainError(
					"INVALID_REQUEST",
					"Invalid compatibility evidence.",
				);
			seen.add(e.id);
		}
		const result = planCompatibility(description, input.evidence);
		await this.options.sources.revalidateSource(source);
		this.options.sources.assertRootEpoch(source.rootEpoch);
		this.options.logger?.debug(
			{
				event: "media.compatibility_checked",
				fileId,
				status: result.direct.status,
			},
			"Media compatibility checked.",
		);
		return result;
	}
}
