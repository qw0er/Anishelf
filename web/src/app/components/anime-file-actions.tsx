import { useQuery } from "@tanstack/react-query";
import {
	clearCapabilityCache,
	removeCompatibility,
	sourceCompatibilityQuery,
} from "../../features/media/public.js";
import { ApiClientError } from "../../shared/api/client.js";
import type { PreparationSummaryResponse } from "../../shared/api/contracts.js";
import type { queryGate } from "../../shared/lib/query-gate.js";
import { FileActions } from "./file-actions.js";
/** Reuse Files commands without giving Anime dependencies on Media or Playback UI. */
export function AnimeFileActions({
	source,
	summary,
	summaryLoading,
	gate,
}: {
	source: { fileId: string; sourceVersion: string };
	summary: PreparationSummaryResponse["files"][number] | undefined;
	summaryLoading: boolean;
	gate: ReturnType<typeof queryGate>;
}) {
	const compatibility = useQuery(sourceCompatibilityQuery(source, gate));
	const changed =
		compatibility.error instanceof ApiClientError &&
		compatibility.error.status === 409;
	return (
		<FileActions
			fileId={source.fileId}
			sourceVersion={source.sourceVersion}
			summary={summary}
			loading={compatibility.isPending || summaryLoading}
			result={compatibility.data ?? null}
			error={compatibility.error}
			disabled={changed}
			onRecheck={async () => {
				clearCapabilityCache();
				await removeCompatibility(source.fileId);
				void compatibility.refetch();
			}}
		/>
	);
}
