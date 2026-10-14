import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Library, ScanLine, SearchX } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Skeleton } from "../../../../shared/components/ui/skeleton.js";
import { getErrorTranslationKey } from "../../../../shared/lib/error-translation.js";
import { IdentificationStatus } from "../../identification-status.js";
import { catalogFilters, catalogSearch } from "../api.js";
import { catalogQuery } from "../queries.js";
import { CatalogFiltersForm } from "./catalog-filters-form.js";
import { CatalogPagination } from "./catalog-pagination.js";
import { CatalogResults } from "./catalog-results.js";

export function AnimeLibrary({
	resourceRoot,
	ready,
}: {
	resourceRoot: string | null;
	ready: boolean;
}) {
	const { t } = useTranslation();
	const [params, setParams] = useSearchParams();
	const filters = catalogFilters(params);
	const location = useLocation();
	const restoredFocus = useRef<string | null>(null);
	const query = useQuery({
		...catalogQuery(filters, useQueryScope()),
		enabled: Boolean(resourceRoot && ready),
	});
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
	function change(key: string, value: string) {
		const next = new URLSearchParams(catalogSearch(filters));
		if (value) next.set(key, value);
		else next.delete(key);
		if (key !== "page") next.delete("page");
		setParams(next);
	}
	const filtered = Boolean(
		filters.query || filters.format || filters.year || filters.availability,
	);
	return (
		<section className="stack-page" aria-label={t("anime.library")}>
			<PageHeader
				title={t("anime.library")}
				description={t("anime.libraryHint")}
			/>
			<IdentificationStatus />
			{!resourceRoot ? (
				<EmptyState
					icon={<FolderPlus size={24} />}
					title={t("anime.setup")}
					actions={
						<Link to="/settings" className="underline">
							{t("app.settings")}
						</Link>
					}
				/>
			) : !ready ? (
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
					<CatalogFiltersForm
						filters={filters}
						filtered={filtered}
						onFilters={setParams}
					/>
					{query.error && (
						<div role="alert" className="space-y-2">
							<p>
								{t(getErrorTranslationKey(query.error) ?? "errors.pageLoad")}
							</p>
							<Button
								variant="outline"
								disabled={query.isFetching}
								onClick={() => void query.refetch()}
							>
								{t("actions.retry")}
							</Button>
						</div>
					)}
					{query.isPending && !query.error && (
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
											<Button variant="outline" onClick={() => setParams({})}>
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
								<CatalogResults
									items={query.data.items}
									librarySearch={location.search}
								/>
							)}
							<CatalogPagination
								page={filters.page}
								fetching={query.isFetching}
								hasNextPage={query.data.hasNextPage}
								onPage={(page) => change("page", String(page))}
							/>
						</>
					)}
				</>
			)}
		</section>
	);
}
