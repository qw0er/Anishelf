import { useTranslation } from "react-i18next";
import {
	Link,
	type RouteObject,
	useLoaderData,
	useOutletContext,
	useSearchParams,
} from "react-router";
import App, { type LibraryContext } from "../App.js";
import InitialLoading from "../components/initial-loading.js";
import { buttonStyles } from "../components/ui/button.js";
import {
	LibraryBrowser,
	ResourceSettings,
} from "../features/library/public.js";
import { FilePlayer } from "../features/playback/public.js";
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
	const listing = useLoaderData<typeof directoryLoader>();
	const scan = useOutletContext<LibraryContext>();
	return <LibraryBrowser listing={listing} scan={scan} />;
}

function PlayerPage() {
	const data = useLoaderData<typeof fileLoader>();
	const { reload, playerVersion, clientConfig } =
		useOutletContext<LibraryContext>();
	const [searchParams] = useSearchParams();
	return (
		<FilePlayer
			key={`${data.file.id}:${playerVersion}`}
			data={data}
			clientConfig={clientConfig}
			returnDirectoryId={searchParams.get("directory")}
			onRetry={reload}
		/>
	);
}

function SettingsPage() {
	const { t } = useTranslation();
	const { settings, scanning, scanPending, clientConfig } =
		useOutletContext<LibraryContext>();
	return settings ? (
		<ResourceSettings
			key={settings.resourceRoot}
			settings={settings}
			clientConfig={clientConfig}
			disabled={scanning || scanPending}
		/>
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
