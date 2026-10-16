import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../../shared/components/ui/button.js";
import { Input } from "../../../../shared/components/ui/input.js";
import type { LibraryFilters } from "../api.js";
import { libraryFilters, librarySearch } from "../api.js";

export function LibraryFiltersForm({
	filters,
	filtered,
	onFilters,
	viewingEnabled,
}: {
	filters: LibraryFilters;
	filtered: boolean;
	onFilters(value: string): void;
	viewingEnabled: boolean;
}) {
	const { t } = useTranslation();
	const [search, setSearch] = useState(filters.query ?? "");
	const [year, setYear] = useState(filters.year ?? "");
	const [expanded, setExpanded] = useState(false);
	const applied = librarySearch(filters);
	const pending = useRef(applied);
	useEffect(() => {
		pending.current = applied;
	}, [applied]);
	function commit(value: string) {
		pending.current = value;
		onFilters(value);
	}
	useEffect(() => setSearch(filters.query ?? ""), [filters.query]);
	useEffect(() => setYear(filters.year ?? ""), [filters.year]);
	function change(key: string, value: string) {
		const next = new URLSearchParams(pending.current);
		if (value.trim()) next.set(key, value.trim());
		else next.delete(key);
		next.delete("page");
		commit(librarySearch(libraryFilters(next)));
	}
	const active = (
		["query", "format", "year", "availability", "viewingStatus"] as const
	).filter((key) => filters[key]);
	return (
		<div className="space-y-3">
			<div className="grid min-w-0 grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
				<form
					className="col-span-2 flex min-w-0 gap-2 sm:col-span-1"
					onSubmit={(event) => {
						event.preventDefault();
						change("query", search);
					}}
				>
					<label htmlFor="anime-search" className="sr-only">
						{t("anime.search")}
					</label>
					<Input
						id="anime-search"
						name="query"
						placeholder={t("anime.search")}
						type="search"
						maxLength={200}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					<Button
						type="submit"
						variant="outline"
						aria-label={t("anime.searchSubmit")}
					>
						<Search size={16} aria-hidden="true" />
					</Button>
				</form>
				<Button
					variant="outline"
					aria-expanded={expanded}
					aria-controls="catalog-filters"
					onClick={() => setExpanded(!expanded)}
				>
					<SlidersHorizontal size={16} aria-hidden="true" />
					{t("anime.filters")}
				</Button>
				<label className="min-w-0">
					<span className="sr-only">{t("anime.sort")}</span>
					<select
						className="form-select w-full"
						value={filters.sort}
						onChange={(event) => change("sort", event.target.value)}
					>
						<option value="title">{t("anime.titleSort")}</option>
						<option value="recent">{t("anime.recentSort")}</option>
					</select>
				</label>
			</div>
			<div id="catalog-filters" hidden={!expanded}>
				<div className="surface-panel grid gap-4 sm:grid-cols-3">
					<label className="min-w-0 space-y-1 text-sm">
						<span>{t("trackingList.scope")}</span>
						<select
							className="form-select block w-full"
							value={filters.scope ?? "local"}
							onChange={(event) => change("scope", event.target.value)}
						>
							<option value="local">{t("trackingList.local")}</option>
							<option value="all">{t("trackingList.all")}</option>
						</select>
					</label>
					<label className="min-w-0 space-y-1 text-sm">
						<span>{t("trackingList.viewingState")}</span>
						<select
							className="form-select block w-full"
							value={filters.viewingStatus ?? ""}
							onChange={(event) => change("viewingStatus", event.target.value)}
							disabled={!viewingEnabled}
						>
							<option value="">{t("trackingList.allStatuses")}</option>
							{[
								"CURRENT",
								"PLANNING",
								"COMPLETED",
								"PAUSED",
								"DROPPED",
								"REPEATING",
								"untracked",
							].map((status) => (
								<option key={status} value={status}>
									{t(
										status === "untracked"
											? "trackingList.untracked"
											: `trackingList.statuses.${status}`,
									)}
								</option>
							))}
						</select>
					</label>

					<label className="space-y-1 text-sm">
						{t("anime.format")}
						<select
							className="form-select w-full"
							value={filters.format ?? ""}
							onChange={(event) => change("format", event.target.value)}
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
					<label htmlFor="anime-year" className="space-y-1 text-sm">
						{t("anime.year")}
						<Input
							id="anime-year"
							type="number"
							min={1}
							max={9999}
							value={year}
							onChange={(event) => setYear(event.target.value)}
							onBlur={(event) => {
								if (event.currentTarget.validity.valid) change("year", year);
								else event.currentTarget.reportValidity();
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									if (event.currentTarget.validity.valid) change("year", year);
								}
							}}
						/>
					</label>
					<label className="space-y-1 text-sm">
						{t("anime.availability")}
						<select
							className="form-select w-full"
							value={filters.availability ?? ""}
							onChange={(event) => change("availability", event.target.value)}
						>
							<option value="">{t("anime.allAvailability")}</option>
							<option value="available">{t("anime.available")}</option>
							<option value="unavailable">{t("anime.unavailable")}</option>
						</select>
					</label>
				</div>
			</div>
			{filtered && (
				<fieldset
					className="flex flex-wrap items-center gap-2"
					aria-label={t("anime.activeFilters")}
				>
					{active.map((key) => (
						<Button
							key={key}
							variant="secondary"
							className="h-8 max-w-full text-xs"
							aria-label={t("anime.removeFilter", {
								filter: t(
									key === "query"
										? "anime.search"
										: key === "viewingStatus"
											? "trackingList.viewingState"
											: `anime.${key}`,
								),
							})}
							onClick={() => change(key, "")}
						>
							<span className="truncate">
								{key === "viewingStatus"
									? t(
											filters.viewingStatus === "untracked"
												? "trackingList.untracked"
												: `trackingList.statuses.${filters.viewingStatus}`,
										)
									: key === "availability"
										? t(`anime.${filters.availability}`)
										: key === "format"
											? filters.format?.replaceAll("_", " ")
											: key === "year"
												? `${t("anime.year")}: ${filters.year}`
												: filters[key]}
							</span>
							<X size={12} aria-hidden="true" />
						</Button>
					))}
					<Button
						variant="ghost"
						className="h-8 text-xs"
						onClick={() =>
							commit(
								librarySearch({
									sort: filters.sort,
									page: 1,
									...(filters.scope ? { scope: filters.scope } : {}),
								}),
							)
						}
					>
						{t("anime.clear")}
					</Button>
				</fieldset>
			)}
		</div>
	);
}
