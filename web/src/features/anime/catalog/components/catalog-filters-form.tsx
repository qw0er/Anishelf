import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Input } from "../../../../shared/components/ui/input.js";
import type { CatalogFilters } from "../api.js";
import { catalogFilters, catalogSearch } from "../api.js";

const selectStyle =
	"h-9 min-w-0 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring";
export function CatalogFiltersForm({
	filters,
	filtered,
	onFilters,
}: {
	filters: CatalogFilters;
	filtered: boolean;
	onFilters(value: string): void;
}) {
	const { t } = useTranslation();
	return (
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
				onFilters(catalogSearch(catalogFilters(next)));
			}}
		>
			<label htmlFor="anime-search" className="min-w-0 flex-1 basis-48 text-sm">
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
					{["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"].map(
						(format) => (
							<option key={format} value={format}>
								{format.replaceAll("_", " ")}
							</option>
						),
					)}
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
				<select name="sort" className={selectStyle} defaultValue={filters.sort}>
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
	);
}
