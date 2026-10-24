import {
	ArrowDownWideNarrow,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "../../../../shared/components/ui/dropdown-menu.js";
import { Input } from "../../../../shared/components/ui/input.js";
import { RadioOptions } from "../../../../shared/components/ui/radio-options.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import type { LibraryFilters } from "../api.js";
import { libraryFilters, librarySearch } from "../api.js";

export function LibraryFiltersForm({
	filters,
	filtered,
	onFilters,
	viewingEnabled,
	actions,
}: {
	filters: LibraryFilters;
	filtered: boolean;
	onFilters(value: string): void;
	viewingEnabled: boolean;
	actions: ReactNode;
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
			<fieldset
				aria-label={t("anime.libraryControls")}
				className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-end gap-2 sm:gap-3"
			>
				<form
					className="flex min-w-0 gap-2"
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
					<Tooltip content={t("anime.searchSubmit")}>
						<Button
							type="submit"
							variant="outline"
							className="size-9 shrink-0 p-0"
							aria-label={t("anime.searchSubmit")}
						>
							<Search size={16} aria-hidden="true" />
						</Button>
					</Tooltip>
				</form>
				<Tooltip content={t("anime.filters")}>
					<Button
						variant="outline"
						className="size-9 p-0 sm:h-9 sm:w-auto sm:px-4"
						aria-label={t("anime.filters")}
						aria-expanded={expanded}
						aria-controls="catalog-filters"
						onClick={() => setExpanded(!expanded)}
					>
						<SlidersHorizontal size={16} aria-hidden="true" />
						<span className="hidden sm:inline">{t("anime.filters")}</span>
					</Button>
				</Tooltip>
				<DropdownMenu>
					<Tooltip content={t("anime.sort")}>
						<DropdownMenuTrigger
							render={
								<Button
									variant="outline"
									aria-label={t("anime.sort")}
									className="size-9 p-0 sm:w-auto sm:px-3"
								/>
							}
						>
							<ArrowDownWideNarrow size={16} aria-hidden="true" />
							<span className="hidden sm:inline">
								{t(
									`anime.${filters.sort === "unwatched" ? "unwatchedSort" : filters.sort === "updated" ? "updatedSort" : filters.sort === "title" ? "titleSort" : "recentSort"}`,
								)}
							</span>
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent>
						<DropdownMenuRadioGroup
							value={filters.sort}
							onValueChange={(value: string) => change("sort", value)}
							aria-label={t("anime.sort")}
						>
							{(["unwatched", "updated", "title", "recent"] as const).map(
								(value) => (
									<DropdownMenuRadioItem key={value} value={value}>
										{t(`anime.${value}Sort`)}
									</DropdownMenuRadioItem>
								),
							)}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				{actions}
			</fieldset>
			<div id="catalog-filters" hidden={!expanded}>
				<div className="surface-panel grid gap-4 sm:grid-cols-2">
					<RadioOptions
						legend={t("trackingList.scope")}
						value={filters.scope ?? "local"}
						onChange={(value) => change("scope", value)}
						options={[
							{ value: "local", label: t("trackingList.local") },
							{ value: "all", label: t("trackingList.all") },
						]}
					/>
					<RadioOptions
						legend={t("trackingList.viewingState")}
						value={filters.viewingStatus ?? "watching"}
						disabled={!viewingEnabled}
						onChange={(value) => change("viewingStatus", value)}
						options={[
							{ value: "all", label: t("trackingList.allStatuses") },
							...[
								"watching",
								"planned",
								"completed",
								"paused",
								"dropped",
								"rewatching",
								"untracked",
							].map((value) => ({
								value,
								label: t(
									value === "untracked"
										? "trackingList.untracked"
										: `trackingList.statuses.${value}`,
								),
							})),
						]}
					/>
					<RadioOptions
						legend={t("anime.format")}
						value={filters.format ?? ""}
						onChange={(value) => change("format", value)}
						options={[
							{ value: "", label: t("anime.allFormats") },
							...[
								"TV",
								"TV_SHORT",
								"MOVIE",
								"SPECIAL",
								"OVA",
								"ONA",
								"MUSIC",
							].map((value) => ({ value, label: value.replaceAll("_", " ") })),
						]}
					/>
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
					<RadioOptions
						legend={t("anime.availability")}
						value={filters.availability ?? ""}
						onChange={(value) => change("availability", value)}
						options={[
							{ value: "", label: t("anime.allAvailability") },
							{ value: "available", label: t("anime.available") },
							{ value: "unavailable", label: t("anime.unavailable") },
						]}
					/>
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
												: filters.viewingStatus === "all"
													? "trackingList.allStatuses"
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
