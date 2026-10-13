import { preparationInteractionPolicy } from "./policy.js";
export const preparationKeys = {
	preparations: ["preparations"] as const,
	tasks: (scope: string, fileId?: string, more?: boolean) =>
		[
			"preparations",
			scope,
			"tasks",
			fileId ?? null,
			...(more === undefined ? [] : [more]),
		] as const,
	summaries: (scope: string, ids: string[]) =>
		["preparations", scope, "summaries", ids] as const,
};

import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../shared/api/queries.js";
import * as api from "./api.js";

export const tasksQuery = (scope: string, fileId?: string, more = false) =>
	queryOptions({
		queryKey: preparationKeys.tasks(scope, fileId, more),
		queryFn: ({ signal }) =>
			fileId
				? api.getFilePreparations(fileId, { signal: boundedSignal(signal) })
				: api.getPreparations({ signal: boundedSignal(signal) }, more),
		refetchInterval: (query) =>
			query.state.data?.tasks.some(
				(task) =>
					["queued", "processing", "cancelling"].includes(task.status) ||
					(fileId !== undefined && task.playbackAvailability === "unknown"),
			)
				? preparationInteractionPolicy.preparationPollIntervalMs
				: false,
	});
export const summariesQuery = (scope: string, ids: string[]) =>
	queryOptions({
		queryKey: preparationKeys.summaries(scope, ids),
		queryFn: async ({ signal }) => {
			const files = [] as Awaited<
				ReturnType<typeof api.getPreparationSummaries>
			>["files"];
			for (let offset = 0; offset < ids.length; offset += 500)
				files.push(
					...(
						await api.getPreparationSummaries(ids.slice(offset, offset + 500), {
							signal: boundedSignal(signal),
						})
					).files,
				);
			return { files };
		},
		refetchInterval: (query) =>
			query.state.data?.files.some((file) =>
				file.versions.some((version) => version.pendingTasks > 0),
			)
				? preparationInteractionPolicy.preparationPollIntervalMs
				: false,
	});
