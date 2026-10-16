import { useQuery } from "@tanstack/react-query";
import { sourceCompatibilityQuery } from "../../features/media/public.js";
import { ApiClientError } from "../../shared/api/client.js";
import type { PreparationSummaryResponse } from "../../shared/api/contracts.js";
import type { queryGate } from "../../shared/lib/query-gate.js";
import { FileActions } from "./file-actions.js";
/** Reuse Files commands without giving Anime dependencies on Media or Playback UI. */
export function AnimeFileActions({
	source,
	summary,
	summaryLoading,
	scope,
	gate,
}: {
	source: { fileId: string; sourceVersion: string };
	summary: PreparationSummaryResponse["files"][number] | undefined;
	summaryLoading: boolean;
	scope: string;
	gate: ReturnType<typeof queryGate>;
}) {
	const compatibility = useQuery(sourceCompatibilityQuery(source, scope, gate));
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
			onRecheck={() => {
				void compatibility.refetch();
			}}
		/>
	);
}
