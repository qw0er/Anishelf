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
import App, { type LibraryContext } from "../App.js";
import { directoryQuery, fileQuery, useQueryScope } from "../api/queries.js";
import InitialLoading from "../components/initial-loading.js";
import { buttonStyles } from "../components/ui/button.js";
import {
	LibraryBrowser,
	ResourceSettings,
} from "../features/library/public.js";
import { FilePlayer } from "../features/playback/public.js";
import { PreparationProfileSettings } from "../features/preparation/public.js";
import RouteError from "./errors.js";
import HistoryPage from "./history.js";
import {
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
	return <LibraryBrowser listing={listing} scan={scan} />;
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
			key={JSON.stringify([
				data.file.id,
				settings?.resourceRoot,
				playerVersion,
			])}
			data={data}
			returnDirectoryId={searchParams.get("directory")}
			onRetry={reload}
			compatibilityScope={JSON.stringify([
				settings?.resourceRoot,
				library?.revision,
			])}
		/>
	);
}

function SettingsPage() {
	const { t } = useTranslation();
	const { settings, scanning, scanPending } =
		useOutletContext<LibraryContext>();
	return settings ? (
		<div className="stack-page">
			<ResourceSettings
				key={settings.resourceRoot}
				settings={settings}
				disabled={scanning || scanPending}
			/>
			<PreparationProfileSettings />
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
			loader: directoryLoader,
			element: <DirectoryPage />,
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
