import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLoaderData, useLocation, useSearchParams } from "react-router";
import { useAnimePlaybackTitle } from "../../../features/anime/public.js";
import {
	clearCapabilityCache,
	removeCompatibility,
} from "../../../features/media/public.js";
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
	const location = useLocation();
	const initial = useLoaderData<typeof fileLoader>();
	const query = useQuery({
		...fileQuery(initial.file.id, useQueryScope()),
	});
	const data = query.data ?? initial;
	const [playerVersion, setPlayerVersion] = useState(0);
	const { reload, settings, library } = useAppRuntime();
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
			autoPlay={location.state?.autoPlay === true}
			returnDirectoryId={searchParams.get("directory")}
			returnTo={animeReturnPath(searchParams)}
			onRetry={async () => {
				clearCapabilityCache();
				await removeCompatibility(data.file.id);
				setPlayerVersion((value) => value + 1);
				await reload();
			}}
		/>
	);
}
