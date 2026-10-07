import { queryOptions } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { interactionPolicy } from "../config/interaction-policy.js";
import * as api from "./client.js";

export const QueryScope = createContext("");
export const useQueryScope = () => useContext(QueryScope);
export const keys = {
	library: ["library"] as const,
	settings: ["settings"] as const,
	directory: (id: string, scope: string) => ["directory", scope, id] as const,
	file: (id: string, scope: string) => ["file", scope, id] as const,
	history: (scope: string) => ["history", scope] as const,
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
	profiles: ["profiles"] as const,
	chapters: (scope: string, fileId: string, sourceVersion: string) =>
		["chapters", scope, fileId, sourceVersion] as const,
	subtitles: (scope: string, fileId: string) =>
		["subtitles", scope, fileId] as const,
	compatibility: (identity: string) => ["compatibility", identity] as const,
};
export const boundedSignal = (
	signal: AbortSignal,
	timeout = interactionPolicy.preparationRequestTimeoutMs,
) => AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
export const libraryQuery = () =>
	queryOptions({
		queryKey: keys.library,
		queryFn: ({ signal }) => api.getLibrary({ signal: boundedSignal(signal) }),
		refetchInterval: (query) =>
			query.state.data?.scan?.status === "running"
				? interactionPolicy.scanPollIntervalMs
				: false,
	});
export const settingsQuery = () =>
	queryOptions({
		queryKey: keys.settings,
		queryFn: ({ signal }) => api.getSettings({ signal: boundedSignal(signal) }),
	});
export const directoryQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: keys.directory(id, scope),
		queryFn: ({ signal }) =>
			api.getDirectory(id, { signal: boundedSignal(signal) }),
	});
export const fileQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: keys.file(id, scope),
		queryFn: ({ signal }) => api.getFile(id, { signal: boundedSignal(signal) }),
	});
export const historyQuery = (scope: string) =>
	queryOptions({
		queryKey: keys.history(scope),
		queryFn: ({ signal }) => api.getHistory({ signal: boundedSignal(signal) }),
	});
export const profilesQuery = () =>
	queryOptions({
		queryKey: keys.profiles,
		queryFn: ({ signal }) =>
			api.getTranscodeProfiles({ signal: boundedSignal(signal) }),
	});
export const tasksQuery = (scope: string, fileId?: string, more = false) =>
	queryOptions({
		queryKey: keys.tasks(scope, fileId, more),
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
				? interactionPolicy.preparationPollIntervalMs
				: false,
	});
export const summariesQuery = (scope: string, ids: string[]) =>
	queryOptions({
		queryKey: keys.summaries(scope, ids),
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
				? interactionPolicy.preparationPollIntervalMs
				: false,
	});
