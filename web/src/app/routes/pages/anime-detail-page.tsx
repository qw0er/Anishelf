import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams } from "react-router";
import { SubscriptionPanel } from "../../../features/acquisition/ui.js";
import type { AnimeResourceActionSlot } from "../../../features/anime/public.js";
import { localWorkDetailQuery } from "../../../features/anime/public.js";
import { AnimeDetail } from "../../../features/anime/ui.js";
import {
	mediacompatibilityInteractionPolicy,
	summariesQuery,
} from "../../../features/media/public.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { queryGate } from "../../../shared/lib/query-gate.js";
import { AnimeFileActions } from "../../components/anime-file-actions.js";
export function AnimeDetailPage() {
	const scope = useQueryScope();
	const { id } = useParams();
	// Subscribe to the detail cache; AnimeDetail remains the owner of the detail fetch.
	const detail = useQuery({
		...localWorkDetailQuery(id ?? "", scope),
		enabled: false,
	});
	const ids = [
		...new Set(
			detail.data?.episodes.flatMap((episode) =>
				episode.versions
					.filter((version) => version.available)
					.map((version) => version.fileId),
			) ?? [],
		),
	].sort();
	const summaries = useQuery({
		...summariesQuery(scope, ids),
		enabled: ids.length > 0,
	});
	const byFile = new Map(
		summaries.data?.files.map((file) => [file.fileId, file]),
	);
	// A different work or resource scope receives independent admission slots.
	// biome-ignore lint/correctness/useExhaustiveDependencies: work/scope identify the negotiation group
	const gate = useMemo(
		() =>
			queryGate(mediacompatibilityInteractionPolicy.compatibilityConcurrency),
		[id, scope],
	);
	const renderResourceActions: AnimeResourceActionSlot = (
		source,
		identificationMenu,
	) => (
		<AnimeFileActions
			key={`${scope}:${source.fileId}:${source.sourceVersion}`}
			source={source}
			identificationMenu={identificationMenu}
			summary={byFile.get(source.fileId)}
			summaryLoading={summaries.isPending}
			gate={gate}
		/>
	);
	return (
		<AnimeDetail
			renderResourceActions={renderResourceActions}
			renderSubscription={(workKey, detail) => (
				<SubscriptionPanel
					key={workKey}
					workKey={workKey}
					initialView={detail.subscription}
					initialActivity={detail.downloads}
				/>
			)}
		/>
	);
}
