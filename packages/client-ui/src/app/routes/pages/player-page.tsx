import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useParams, useSearchParams } from "react-router";
import { useAnimePlaybackTitle } from "../../../features/anime/public.js";

import { FilePlayer, PlayerHeader } from "../../../features/playback/ui.js";
import {
	fileQuery,
	resourceContext,
} from "../../../features/resources/public.js";
import { ApiClientError } from "../../../shared/api/client.js";
import type { FileResponse } from "../../../shared/api/contracts.js";
import {
	queryScopeIdentity,
	useQueryScope,
} from "../../../shared/api/queries.js";
import { queryLoadFailure } from "../../../shared/components/load-failure.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { useRefreshError } from "../../../shared/hooks/use-refresh-error.js";
import { animeReturnPath } from "../../../shared/navigation.js";
import { playbackUiSlots } from "../../composition/playback-ui.js";
import { useAppRuntime } from "../../runtime/context.js";
import { RouteLoadFailure } from "../errors.js";
export function PlayerPage() {
	const { id = "" } = useParams();
	const scope = useQueryScope();
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const query = useQuery({
		...fileQuery(id, scope),
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === id &&
			queryScopeIdentity(previousQuery.queryKey[1]) ===
				queryScopeIdentity(scope)
				? previous
				: undefined,
	});
	const unavailable =
		query.error instanceof ApiClientError &&
		[403, 404, 410].includes(query.error.status ?? 0);
	const data = unavailable ? undefined : query.data;
	useRefreshError(
		"file-refresh",
		data ? query.error : null,
		query.errorUpdatedAt,
		() => void query.refetch(),
		{ scoped: true },
	);
	if (data) return <LoadedPlayerPage key={data.file.id} data={data} />;
	const failure = queryLoadFailure(query);
	return (
		<section
			className="flex min-w-0 flex-col gap-3 sm:gap-4"
			aria-label={t("player.label")}
		>
			<PlayerHeader
				returnDirectoryId={searchParams.get("directory") || "root"}
				returnTo={animeReturnPath(searchParams)}
			/>
			{failure ? (
				<RouteLoadFailure kind="file" hideReturnLink {...failure} />
			) : (
				<div role="status" aria-label={t("navigation.loadingFile")}>
					<Skeleton className="aspect-video w-full" />
				</div>
			)}
		</section>
	);
}

function LoadedPlayerPage({ data }: { data: FileResponse }) {
	const location = useLocation();
	const [playerVersion, setPlayerVersion] = useState(0);
	const { reload, settings, library } = useAppRuntime();
	const resources = resourceContext(settings, library);
	const [searchParams] = useSearchParams();
	const displayTitle = useAnimePlaybackTitle(data.file.id, {
		workId: searchParams.get("anime"),
		episodeId: searchParams.get("episode"),
		sourceVersion: searchParams.get("version"),
	});
	return (
		<FilePlayer
			slots={playbackUiSlots}
			key={JSON.stringify([data.file.id, resources.identity, playerVersion])}
			data={data}
			displayTitle={displayTitle}
			autoPlay={location.state?.autoPlay === true}
			returnDirectoryId={searchParams.get("directory")}
			returnTo={animeReturnPath(searchParams)}
			onRetry={async () => {
				setPlayerVersion((value) => value + 1);
				await reload();
			}}
		/>
	);
}
