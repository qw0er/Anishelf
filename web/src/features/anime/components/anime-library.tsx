import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	Link,
	useLocation,
	useOutletContext,
	useSearchParams,
} from "react-router";
import { useQueryScope } from "../../../shared/api/queries.js";
import { Button, buttonStyles } from "../../../shared/components/ui/button.js";
import { Input } from "../../../shared/components/ui/input.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import type { LibraryContext } from "../../resources/public.js";
import { catalogFilters, catalogSearch } from "../api.js";
import { catalogQuery } from "../queries.js";
import { Artwork } from "./artwork.js";
import { IdentificationStatus } from "./identification-status.js";

const selectStyle =
	"h-9 min-w-0 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring";
export function AnimeLibrary() {
	const { t } = useTranslation();
	const [params, setParams] = useSearchParams();
	const filters = catalogFilters(params);
	const { settings, library } = useOutletContext<LibraryContext>();
	const location = useLocation();
	const restoredFocus = useRef<string | null>(null);
	const query = useQuery({
		...catalogQuery(filters, useQueryScope()),
		enabled: Boolean(settings?.resourceRoot && library?.ready),
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
			<IdentificationStatus />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="page-title">{t("anime.library")}</h1>
					<p className="text-sm text-muted-foreground">
						{t("anime.libraryHint")}
					</p>
				</div>
				<Link to="/review" className={buttonStyles("outline")}>
					{t("review.title")}
				</Link>
				<Link to="/directories/root" className={buttonStyles("outline")}>
					{t("app.files")}
				</Link>
			</div>
			{!settings?.resourceRoot ? (
				<p>
					{t("anime.setup")}{" "}
					<Link to="/settings" className="underline">
						{t("app.settings")}
					</Link>
				</p>
			) : !library?.ready ? (
				<p role="status">
					{t("anime.scanFirst")}{" "}
					<Link to="/directories/root" className="underline">
						{t("app.files")}
					</Link>
				</p>
			) : (
				<>
					<form
						key={catalogSearch(filters)}
						className="flex flex-wrap items-end gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							const next = new URLSearchParams();
							for (const [key, value] of form)
								if (typeof value === "string" && value.trim())
									next.set(key, value.trim());
							setParams(catalogSearch(catalogFilters(next)));
						}}
					>
						<label
							htmlFor="anime-search"
							className="min-w-0 flex-1 basis-48 text-sm"
						>
							{t("anime.search")}
							<Input
								id="anime-search"
								name="query"
								defaultValue={filters.query ?? ""}
								maxLength={200}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							{t("anime.format")}
							<select
								className={selectStyle}
								name="format"
								defaultValue={filters.format ?? ""}
							>
								<option value="">{t("anime.allFormats")}</option>
								{[
									"TV",
									"TV_SHORT",
									"MOVIE",
									"SPECIAL",
									"OVA",
									"ONA",
									"MUSIC",
								].map((format) => (
									<option key={format} value={format}>
										{format.replaceAll("_", " ")}
									</option>
								))}
							</select>
						</label>
						<label htmlFor="anime-year" className="w-24 text-sm">
							{t("anime.year")}
							<Input
								id="anime-year"
								name="year"
								type="number"
								min={1}
								max={9999}
								defaultValue={filters.year ?? ""}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							{t("anime.availability")}
							<select
								name="availability"
								className={selectStyle}
								defaultValue={filters.availability ?? ""}
							>
								<option value="">{t("anime.allAvailability")}</option>
								<option value="available">{t("anime.available")}</option>
								<option value="unavailable">{t("anime.unavailable")}</option>
							</select>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							{t("anime.sort")}
							<select
								name="sort"
								className={selectStyle}
								defaultValue={filters.sort}
							>
								<option value="title">{t("anime.titleSort")}</option>
								<option value="recent">{t("anime.recentSort")}</option>
							</select>
						</label>
						<Button type="submit">{t("anime.apply")}</Button>
						{filtered && (
							<Link className={buttonStyles("outline")} to="/">
								{t("anime.clear")}
							</Link>
						)}
					</form>
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
							className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6"
						>
							{[1, 2, 3, 4, 5, 6].map((id) => (
								<Skeleton key={id} className="aspect-[2/3]" />
							))}
						</div>
					)}
					{query.data && (
						<>
							{query.data.items.length === 0 ? (
								<p role="status">
									{t(
										filtered || filters.page > 1
											? "anime.noResults"
											: "anime.empty",
									)}
								</p>
							) : (
								<ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
									{query.data.items.map((work) => (
										<li key={work.id} className="min-w-0">
											<Link
												id={`work-${work.id}`}
												className="block overflow-hidden rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
												to={`/anime/${encodeURIComponent(work.id)}?${new URLSearchParams({ library: `/${location.search}` })}`}
												aria-label={work.displayTitle}
											>
												<Artwork
													key={work.updatedAt}
													url={work.coverUrl}
													title={work.displayTitle}
												/>
												<div className="space-y-1 p-3">
													<h2
														className="line-clamp-2 font-medium wrap-anywhere"
														title={work.displayTitle}
													>
														{work.displayTitle}
													</h2>
													<p className="text-xs text-muted-foreground">
														{work.format?.replaceAll("_", " ") ??
															t("anime.unknownFormat")}{" "}
														· {work.year ?? t("anime.unknownYear")}
													</p>
													<p className="text-xs">
														{work.format === "MOVIE"
															? t(
																	work.availableEpisodes > 0
																		? "anime.movieAvailable"
																		: "anime.unavailable",
																)
															: work.episodeCount === null
																? t("anime.availableCount", {
																		count: work.availableEpisodes,
																	})
																: t("anime.regularCount", {
																		count: work.availableRegularEpisodes,
																		total: work.episodeCount,
																	})}
													</p>
													{work.format !== "MOVIE" &&
														work.episodeCount !== null &&
														work.availableEpisodes >
															work.availableRegularEpisodes && (
															<p className="text-xs">
																{t("anime.additionalAvailable", {
																	count:
																		work.availableEpisodes -
																		work.availableRegularEpisodes,
																})}
															</p>
														)}
													{work.metadataStale && (
														<p className="text-xs text-muted-foreground">
															{t("anime.cached")}
														</p>
													)}
													{work.availableEpisodes === 0 && (
														<p className="text-xs text-muted-foreground">
															{t("anime.unavailable")}
														</p>
													)}
												</div>
											</Link>
										</li>
									))}
								</ul>
							)}
							<fieldset
								className="action-row"
								aria-label={t("anime.pagination")}
							>
								<Button
									variant="outline"
									disabled={filters.page === 1 || query.isFetching}
									onClick={() => change("page", String(filters.page - 1))}
								>
									{t("anime.previous")}
								</Button>
								<span>{t("anime.page", { page: filters.page })}</span>
								<Button
									variant="outline"
									disabled={!query.data.hasNextPage || query.isFetching}
									onClick={() => change("page", String(filters.page + 1))}
								>
									{t("anime.next")}
								</Button>
							</fieldset>
						</>
					)}
				</>
			)}
		</section>
	);
}
