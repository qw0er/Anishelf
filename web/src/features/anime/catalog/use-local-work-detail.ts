import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { isRequestCancelled } from "../../../shared/api/client.js";
import type { LocalWorkDetailResponse } from "../../../shared/api/contracts.js";
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
import { invalidateAnimeQueries } from "../shared/query-keys.js";
import { refreshLocalWorkDetail } from "./api.js";
import type { Episode, Version } from "./detail-format.js";
export function useLocalWorkDetail(data: LocalWorkDetailResponse) {
	const client = useQueryClient();
	const { t } = useTranslation();
	const [params] = useSearchParams();
	const libraryPath = libraryReturnPath(params.get("library"));
	const { work, episodes } = data;
	const version = `${work.revision}:${data.metadata.snapshotId}`;
	const previousVersion = useRef(version);
	useEffect(() => {
		if (previousVersion.current !== version) {
			previousVersion.current = version;
			void invalidateAnimeQueries(client, "local");
		}
	}, [client, version]);

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
		mutationFn: () => refreshLocalWorkDetail(work.id, work.revision),
		onSuccess: async (result) => {
			reportMetadataRefresh(client, result.metadata, true);
			await invalidateAnimeQueries(client, "info");
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
export type LocalWorkDetailController = ReturnType<typeof useLocalWorkDetail>;
