import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { isRequestCancelled } from "../../../shared/api/client.js";
import type { CatalogDetailResponse } from "../../../shared/api/contracts.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import {
	animePlayerPath,
	libraryReturnPath,
} from "../../../shared/navigation.js";
import {
	metadataRefreshNoticeId,
	relationsQuery,
	reportMetadataRefresh,
} from "../metadata/public.js";
import { animeLibraryQueryKey } from "../shared/query-keys.js";
import { refreshWork } from "./api.js";
import type { Episode, Version } from "./detail-format.js";
import { workQuery } from "./queries.js";
export function useWorkDetail(data: CatalogDetailResponse) {
	const scope = useQueryScope();
	const client = useQueryClient();
	const { t } = useTranslation();
	const [params] = useSearchParams();
	const libraryPath = libraryReturnPath(params.get("library"));
	const { work, episodes } = data;
	const previousRevision = useRef(work.revision);
	useEffect(() => {
		if (previousRevision.current !== work.revision) {
			previousRevision.current = work.revision;
			void client.invalidateQueries({
				queryKey: [...animeLibraryQueryKey, scope],
			});
		}
	}, [client, scope, work.revision]);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = episodes.find((episode) => episode.id === selectedId);
	const [showSpoilers, setShowSpoilers] = useState(false);
	const [relationsPage, setRelationsPage] = useState(1);
	const relations = useQuery(
		relationsQuery(work.reference.provider, work.reference.id, relationsPage),
	);
	const noticeId = metadataRefreshNoticeId(
		work.reference.provider,
		work.reference.id,
	);
	const refresh = useMutation({
		onMutate: () => toast.close(noticeId),
		onError: (error) => {
			if (!isRequestCancelled(error))
				toast.add({
					id: noticeId,
					type: "error",
					priority: "high",
					title: t(getErrorTranslationKey(error) ?? "anime.refreshFailed"),
				});
		},
		mutationFn: () => refreshWork(work.id, work.revision),
		onSuccess: async (result) => {
			reportMetadataRefresh(client, result.metadata, true);
			client.setQueryData(workQuery(work.id, scope).queryKey, result);
			await client.invalidateQueries({
				queryKey: [...animeLibraryQueryKey, scope],
			});
		},
	});
	function playPath(version: Version, episode: Episode) {
		return animePlayerPath(
			version.fileId,
			work.id,
			episode.id,
			libraryPath,
			version.sourceVersion,
		);
	}
	return {
		libraryPath,
		selected,
		showSpoilers,
		relationsPage,
		relations,
		refresh,
		playPath,
		selectEpisode: setSelectedId,
		toggleSpoilers: () => setShowSpoilers((value) => !value),
		closeVersions: () => setSelectedId(null),
		changeRelationsPage: setRelationsPage,
	};
}
export type WorkDetailController = ReturnType<typeof useWorkDetail>;
