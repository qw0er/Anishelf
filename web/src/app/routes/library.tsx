import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
	Link,
	type RouteObject,
	useLoaderData,
	useOutletContext,
	useParams,
	useSearchParams,
} from "react-router";
import { AnimeDetail, AnimeLibrary } from "../../features/anime/ui.js";
import {
	usePreparationAction,
	usePreparationContext,
} from "../../features/media/public.js";
import { FilePlayer, HistoryPage } from "../../features/playback/ui.js";
import type { LibraryContext } from "../../features/resources/public.js";
import { directoryQuery, fileQuery } from "../../features/resources/public.js";
import { LibraryBrowser } from "../../features/resources/ui.js";
import {
	ExternalPlayerSettings,
	PreparationProfileSettings,
	ResourceSettings,
} from "../../features/settings/ui.js";
import { useQueryScope } from "../../shared/api/queries.js";
import { buttonStyles } from "../../shared/components/ui/button.js";
import { animeReturnPath } from "../../shared/navigation.js";
import App from "../App.js";
import { FileActions } from "../components/file-actions.js";
import InitialLoading from "../components/initial-loading.js";
import { playbackUiSlots } from "../composition/playback-ui.js";
import RouteError from "./errors.js";
import {
	animeLoader,
	catalogLoader,
	directoryLoader,
	fileLoader,
	historyLoader,
	libraryLoader,
	scanAction,
	settingsAction,
} from "./loaders.js";

function DirectoryPage() {
	const initial = useLoaderData<typeof directoryLoader>();
	const { id } = useParams();
	const query = useQuery({
		...directoryQuery(id ?? "root", useQueryScope()),
	});
	const listing = query.data ?? initial;
	const scan = useOutletContext<LibraryContext>();
	if (query.error && !query.data) throw query.error;
	return (
		<LibraryBrowser
			listing={listing}
			scan={scan}
			renderFileActions={(state) => <FileActions {...state} />}
		/>
	);
}

function PlayerPage() {
	const initial = useLoaderData<typeof fileLoader>();
	const query = useQuery({
		...fileQuery(initial.file.id, useQueryScope()),
	});
	const data = query.data ?? initial;
	const { reload, playerVersion, settings, library } =
		useOutletContext<LibraryContext>();
	const [searchParams] = useSearchParams();
	if (query.error && !query.data) throw query.error;
	return (
		<FilePlayer
			slots={playbackUiSlots}
			key={JSON.stringify([
				data.file.id,
				settings?.resourceRoot,
				playerVersion,
			])}
			data={data}
			returnDirectoryId={searchParams.get("directory")}
			returnTo={animeReturnPath(searchParams)}
			onRetry={reload}
			compatibilityScope={JSON.stringify([
				settings?.resourceRoot,
				library?.revision,
			])}
		/>
	);
}

function SettingsPage() {
	const preparation = usePreparationContext();
	const action = usePreparationAction();
	const { t } = useTranslation();
	const { settings, scanning, scanPending } =
		useOutletContext<LibraryContext>();
	return settings ? (
		<div className="stack-page mx-auto w-full max-w-2xl">
			<ResourceSettings
				key={settings.resourceRoot}
				settings={settings}
				disabled={scanning || scanPending}
			/>
			<PreparationProfileSettings preparation={preparation} action={action} />
			<ExternalPlayerSettings />
		</div>
	) : (
		<section role="alert">{t("errors.settingsUnavailable")}</section>
	);
}

function NotFoundPage() {
	const { t } = useTranslation();
	return (
		<section className="flex min-w-0 flex-col gap-4">
			<h1 className="page-title">{t("navigation.pageNotFound")}</h1>
			<div className="action-row">
				<Link className={buttonStyles("outline")} to="/">
					{t("navigation.goToRoot")}
				</Link>
			</div>
		</section>
	);
}

export const libraryRoute: RouteObject = {
	id: "library",
	path: "/",
	element: <App />,
	loader: libraryLoader,
	action: scanAction,
	errorElement: <RouteError kind="page" />,
	hydrateFallbackElement: <InitialLoading />,
	children: [
		{
			path: "history",
			loader: historyLoader,
			element: <HistoryPage />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "settings",
			action: settingsAction,
			element: <SettingsPage />,
		},
		{
			index: true,
			loader: catalogLoader,
			element: <AnimeLibrary />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "anime/:id",
			loader: animeLoader,
			element: <AnimeDetail />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "directories/:id",
			loader: directoryLoader,
			element: <DirectoryPage />,
			errorElement: <RouteError kind="directory" />,
		},
		{
			path: "files/:id",
			loader: fileLoader,
			element: <PlayerPage />,
			errorElement: <RouteError kind="file" />,
		},
		{
			path: "*",
			element: <NotFoundPage />,
		},
	],
};
