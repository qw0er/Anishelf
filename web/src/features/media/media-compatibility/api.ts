import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
	CompatibilityResult,
} from "../../../shared/api/contracts.js";

export function inspectMediaCompatibility(
	input: {
		fileId: string;
		sourceVersion?: string;
		audioStreamIndices?: number[];
		output?: NonNullable<CompatibilityCheckRequest["output"]>;
	},
	options?: RequestOptions,
): Promise<CompatibilityInspection> {
	const query = new URLSearchParams();
	if (input.audioStreamIndices !== undefined)
		query.set("audioStreamIndices", input.audioStreamIndices.join(","));
	if (input.sourceVersion) query.set("sourceVersion", input.sourceVersion);
	if (input.output) {
		query.set("profileId", input.output.profileId);
		query.set("target", input.output.target);
	}
	const suffix = query.size ? `?${query}` : "";
	return request(
		`/api/files/${encodeURIComponent(input.fileId)}/compatibility${suffix}`,
		"GET",
		options,
	);
}
export function checkMediaCompatibility(
	input: CompatibilityCheckRequest & {
		fileId: string;
	},
	options?: RequestOptions,
): Promise<CompatibilityResult> {
	const { fileId, ...body } = input;
	return request(
		`/api/files/${encodeURIComponent(fileId)}/compatibility`,
		"POST",
		options,
		body,
	);
}
