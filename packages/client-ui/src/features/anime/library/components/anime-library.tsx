import { FolderPlus, Library, ScanLine, SearchX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router";
import { getClientRuntime } from "../../../../shared/api/connection.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import {
	LoadFailure,
	queryLoadFailure,
} from "../../../../shared/components/load-failure.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Skeleton } from "../../../../shared/components/ui/skeleton.js";
import { TrackingFeedback } from "../../tracking/public.js";
import { activeLibraryFilters, libraryFilters, librarySearch } from "../api.js";
import { useLibraryData } from "../use-library-data.js";
import { LibraryFiltersForm } from "./library-filters-form.js";
import { LibraryPagination } from "./library-pagination.js";
import { LibraryResults } from "./library-results.js";
import { LibraryTrackingAction } from "./library-tracking-action.js";

const libraryFilterSessionKey = "anishelf:anime-library:filters";

function readLibraryFilterSession() {
	try {
		return getClientRuntime().platform.sessionStorage.getItem(
			libraryFilterSessionKey,
		);
	} catch (error) {
		console.warn("[AnimeLibrary] Could not read tab-session filters.", error);
		return null;
	}
}

function writeLibraryFilterSession(search: string) {
	try {
		if (search)
			getClientRuntime().platform.sessionStorage.setItem(
				libraryFilterSessionKey,
				search,
			);
		else
			getClientRuntime().platform.sessionStorage.removeItem(
				libraryFilterSessionKey,
			);
	} catch (error) {
		console.warn("[AnimeLibrary] Could not save tab-session filters.", error);
	}
}

export function AnimeLibrary({
	configured,
	ready,
}: {
	configured: boolean;
	ready: boolean;
}) {
	const { t } = useTranslation();
	const [params, setParams] = useSearchParams();
	const filters = libraryFilters(params);
	const location = useLocation();
	const restoredFocus = useRef<string | null>(null);
	const [filterSessionReady, setFilterSessionReady] = useState(false);
	const setLibrarySearch = useCallback(
		(search: string) => {
			writeLibraryFilterSession(search);
			setParams(search);
		},
		[setParams],
	);
	useEffect(() => {
		if (location.search) {
			writeLibraryFilterSession(
				librarySearch(libraryFilters(new URLSearchParams(location.search))),
			);
			setFilterSessionReady(true);
			return;
		}
		const saved = readLibraryFilterSession();
		if (saved) setParams(saved, { replace: true });
		else setFilterSessionReady(true);
	}, [location.search, setParams]);
	const canBrowse =
		filterSessionReady &&
		(Boolean(configured && ready) || filters.scope === "all");
	const query = useLibraryData(filters, canBrowse);
	useEffect(() => {
		const id = location.state?.focusWork;
		if (
			typeof id === "string" &&
			query.data &&
			restoredFocus.current !== location.key
		) {
			restoredFocus.current = location.key;
			document.getElementById(`work-${id}`)?.focus({ preventScroll: true });
		}
	}, [location.key, location.state, query.data]);
	const viewingEnabled = Boolean(query.account?.account);
	const activeFilters = activeLibraryFilters(filters, viewingEnabled);
	const filtered = activeFilters.length > 0;
	const failure = !query.data && queryLoadFailure(query);
	return (
		<section
			className="stack-page library-page"
			aria-label={t("anime.library")}
		>
			<PageHeader
				title={t("anime.library")}
				description={t("anime.libraryHint")}
			/>
			<LibraryFiltersForm
				filters={filters}
				active={activeFilters}
				onFilters={setLibrarySearch}
				viewingEnabled={viewingEnabled}
				actions={
					query.accountError ? (
						<Button variant="outline" onClick={() => void query.retryAccount()}>
							{t("trackingAccount.refresh")}
						</Button>
					) : (
						<LibraryTrackingAction
							account={query.account}
							snapshot={query.data?.tracking ?? undefined}
							refresh={query.refresh}
						/>
					)
				}
			/>
			{query.data?.tracking && (
				<TrackingFeedback snapshot={query.data.tracking} />
			)}
			{!configured && filters.scope !== "all" ? (
				<EmptyState
					icon={<FolderPlus size={24} />}
					title={t("anime.setup")}
					actions={
						<Link to="/settings" className="underline">
							{t("app.settings")}
						</Link>
					}
				/>
			) : !ready && filters.scope !== "all" ? (
				<EmptyState
					icon={<ScanLine size={24} />}
					title={t("anime.scanFirst")}
					actions={
						<Link to="/directories/root" className="underline">
							{t("app.files")}
						</Link>
					}
				/>
			) : (
				<>
					{failure && (
						<LoadFailure message={t("errors.animeLibraryLoad")} {...failure} />
					)}
					{query.isPending && !failure && (
						<div
							role="status"
							aria-label={t("anime.loading")}
							className="poster-grid"
						>
							{[1, 2, 3, 4, 5, 6].map((id) => (
								<Skeleton key={id} className="aspect-2/3" />
							))}
						</div>
					)}
					{query.data && (
						<>
							{query.data.items.length === 0 ? (
								<EmptyState
									icon={
										filtered || filters.page > 1 ? (
											<SearchX size={24} />
										) : (
											<Library size={24} />
										)
									}
									title={t(
										filtered || filters.page > 1
											? "anime.noResults"
											: "anime.empty",
									)}
									actions={
										filtered || filters.page > 1 ? (
											<Button
												variant="outline"
												onClick={() =>
													setLibrarySearch(
														librarySearch({
															sort: "unwatched",
															page: 1,
															viewingStatus: "all",
															...(filters.scope
																? { scope: filters.scope }
																: {}),
														}),
													)
												}
											>
												{t("anime.clear")}
											</Button>
										) : (
											<Link to="/directories/root" className="underline">
												{t("app.files")}
											</Link>
										)
									}
								/>
							) : (
								<LibraryResults
									items={query.data.items}
									viewingKnown={query.data.tracking?.fetchedAt != null}
									librarySearch={location.search}
								/>
							)}
							<LibraryPagination
								page={filters.page}
								fetching={query.isFetching}
								hasNextPage={query.data.hasNextPage}
								onPage={(page) =>
									setLibrarySearch(librarySearch({ ...filters, page }))
								}
							/>
						</>
					)}
				</>
			)}
		</section>
	);
}
