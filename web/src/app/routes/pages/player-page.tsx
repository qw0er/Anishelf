import { useQuery } from "@tanstack/react-query";
import { useLoaderData, useSearchParams } from "react-router";
import { useAnimePlaybackTitle } from "../../../features/anime/public.js";
import { FilePlayer } from "../../../features/playback/ui.js";
import {
	fileQuery,
	resourceContext,
} from "../../../features/resources/public.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { animeReturnPath } from "../../../shared/navigation.js";
import { playbackUiSlots } from "../../composition/playback-ui.js";
import { useAppRuntime } from "../../runtime/context.js";
import type { fileLoader } from "../resources-data.js";
export function PlayerPage() {
	const initial = useLoaderData<typeof fileLoader>();
	const query = useQuery({
		...fileQuery(initial.file.id, useQueryScope()),
	});
	const data = query.data ?? initial;
	const { reload, playerVersion, settings, library } = useAppRuntime();
	const resources = resourceContext(settings, library);
	const [searchParams] = useSearchParams();
	const displayTitle = useAnimePlaybackTitle(data.file.id, {
		workId: searchParams.get("anime"),
		episodeId: searchParams.get("episode"),
		sourceVersion: searchParams.get("version"),
	});
	if (query.error && !query.data) throw query.error;
	return (
		<FilePlayer
			slots={playbackUiSlots}
			key={JSON.stringify([data.file.id, resources.identity, playerVersion])}
			data={data}
			displayTitle={displayTitle}
			returnDirectoryId={searchParams.get("directory")}
			returnTo={animeReturnPath(searchParams)}
			onRetry={reload}
			compatibilityScope={resources.scope}
		/>
	);
}
