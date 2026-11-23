import type { OfflineCacheEntry } from "@anishelf/contracts/offline-cache";
import { HardDriveDownload, RotateCcw, Search, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router";
import { EmptyState } from "../../../shared/components/empty-state.js";
import { PageHeader } from "../../../shared/components/page-header.js";
import { Button, buttonStyles } from "../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../../shared/components/ui/dialog.js";
import { InlineError } from "../../../shared/components/ui/inline-error.js";
import { Input } from "../../../shared/components/ui/input.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../shared/components/ui/native-select.js";
import { PaginationControls } from "../../../shared/components/ui/pagination-controls.js";
import { RefreshButton } from "../../../shared/components/ui/refresh-button.js";
import { Spinner } from "../../../shared/components/ui/spinner.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { formatFileSize } from "../../resources/public.js";
import { CacheActionButton, OfflineCacheRow } from "./cache-row.js";
import { pendingCache, useOfflineCache } from "./state.js";

const pageSize = 20;
const filters = ["active", "ready", "failed", "unavailable"] as const;

function groupByWork(entries: readonly OfflineCacheEntry[]) {
	const groups = new Map<
		string,
		{
			title: string;
			rows: { entry: OfflineCacheEntry; label: string; number: string }[];
		}
	>();
	for (const entry of entries) {
		const work = entry.episodes[0];
		const key = work ? JSON.stringify([entry.server, work.workId]) : "";
		const group = groups.get(key) ?? { title: work?.workTitle ?? "", rows: [] };
		const episodes = entry.episodes.filter(
			(episode) => episode.workId === work?.workId,
		);
		group.rows.push({
			entry,
			label: episodes.map((episode) => episode.label).join(", "),
			number: work?.number ?? "",
		});
		groups.set(key, group);
	}
	return [...groups.entries()].map(([key, { title, rows }]) => ({
		key,
		title,
		rows: rows.sort((a, b) =>
			a.number.localeCompare(b.number, undefined, { numeric: true }),
		),
	}));
}

function matches(entry: OfflineCacheEntry, search: string, filter: string) {
	if (filter === "active" && !pendingCache(entry.status)) return false;
	if (filter && filter !== "active" && filter !== entry.status) return false;
	if (!search) return true;
	return [
		entry.name,
		...entry.episodes.flatMap(({ workTitle, label, number }) => [
			workTitle,
			label,
			number,
		]),
	].some((value) => value.normalize("NFKC").toLowerCase().includes(search));
}

export function OfflineCachePage() {
	const { t, i18n } = useTranslation();
	const cache = useOfflineCache();
	const { search: locationSearch } = useLocation();
	const [params, setParams] = useSearchParams();
	const [removing, setRemoving] = useState<OfflineCacheEntry>();
	const searchInput = useRef<HTMLInputElement>(null);
	const cancelRemove = useRef<HTMLButtonElement>(null);
	const removeTrigger = useRef<HTMLButtonElement>(null);
	if (!cache) return null;
	const { entries, status, server, refreshing, operations, perform } = cache;
	const count = entries.filter((entry) => entry.status === "ready").length;
	const size = (bytes: number) => formatFileSize(bytes, i18n.language);
	const total = entries.reduce((bytes, entry) => bytes + entry.sizeBytes, 0);
	const query = params.get("search")?.slice(0, 500) ?? "";
	const search = query.normalize("NFKC").trim().toLowerCase();
	const filter = filters.find((value) => value === params.get("status")) ?? "";
	const requestedPage = Math.max(
		1,
		Math.floor(Number(params.get("page"))) || 1,
	);
	const filtered = entries.filter((entry) => matches(entry, search, filter));
	const groups = groupByWork(filtered);
	const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
	const page = Math.min(requestedPage, pages);
	const rows = new Set(
		groups
			.flatMap((group) => group.rows)
			.slice((page - 1) * pageSize, page * pageSize),
	);
	const removalPending = !!removing && operations.get(removing.id) === "remove";
	const selected =
		removing && entries.find((entry) => entry.id === removing.id);
	const removalBlocked =
		!selected ||
		selected.playing ||
		pendingCache(selected.status) ||
		!!operations.get(selected.id);

	function change(key: "search" | "status" | "page", value: string) {
		const next = new URLSearchParams(params);
		if (value) next.set(key, value);
		else next.delete(key);
		if (key !== "page") next.delete("page");
		setParams(next, {
			replace: key === "search",
			preventScrollReset: key !== "page",
		});
	}

	function resetFilters() {
		const next = new URLSearchParams(params);
		for (const key of ["search", "status", "page"]) next.delete(key);
		setParams(next, { preventScrollReset: true });
	}

	async function removeSelected() {
		if (!selected || removalBlocked) return;
		if (await perform("remove", selected.id)) {
			setRemoving(undefined);
			toast.add({ type: "success", title: t("offlineCache.removed") });
		}
	}

	return (
		<section className="stack-page" aria-labelledby="offline-cache-title">
			<PageHeader
				id="offline-cache-title"
				title={t("offlineCache.title")}
				description={
					(status === "ready" || entries.length > 0) && (
						<span className="block text-xs" aria-live="polite">
							{t("offlineCache.summary", { count, size: size(total) })}
						</span>
					)
				}
			/>
			<div className="surface-panel space-y-4">
				<div className="flex min-w-0 flex-wrap items-center gap-2 border-b pb-4">
					<Input
						ref={searchInput}
						className="flex-[1_1_min(100%,22rem)]"
						type="search"
						aria-label={t("offlineCache.search")}
						placeholder={t("offlineCache.searchPlaceholder")}
						maxLength={500}
						value={query}
						onChange={(event) => change("search", event.target.value)}
					/>
					<div className="min-w-0 flex-[1_1_min(100%,11rem)] sm:grow-0">
						<NativeSelect
							aria-label={t("offlineCache.filterStatus")}
							value={filter}
							onChange={(event) => change("status", event.target.value)}
						>
							<NativeSelectOption value="">
								{t("offlineCache.allStatuses")}
							</NativeSelectOption>
							{filters.map((value) => (
								<NativeSelectOption key={value} value={value}>
									{value === "active"
										? t("offlineCache.inProgress")
										: t(`offlineCache.status.${value}`)}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<RefreshButton
						label={t("offlineCache.refresh")}
						busy={refreshing}
						focusableWhenDisabled
						onClick={cache.refresh}
					/>
				</div>
				{status === "loading" && entries.length === 0 && (
					<p className="flex items-center gap-2 supporting-text" role="status">
						<Spinner /> {t("loading.generic")}
					</p>
				)}
				{status === "error" && entries.length === 0 && (
					<div className="space-y-2">
						<InlineError>{t("offlineCache.listFailed")}</InlineError>
						<CacheActionButton
							variant="outline"
							icon={RotateCcw}
							busy={refreshing}
							onClick={cache.refresh}
						>
							{t("actions.retry")}
						</CacheActionButton>
					</div>
				)}
				{(status === "ready" || entries.length > 0) &&
					filtered.length === 0 && (
						<EmptyState
							embedded
							icon={
								entries.length ? (
									<Search size={24} />
								) : (
									<HardDriveDownload size={24} />
								)
							}
							title={t(
								entries.length
									? "offlineCache.noMatchesTitle"
									: "offlineCache.emptyTitle",
							)}
							description={t(
								entries.length
									? "offlineCache.noMatches"
									: "offlineCache.empty",
							)}
							actions={
								entries.length ? (
									<Button
										variant="outline"
										className="h-auto min-h-9 max-w-full whitespace-normal py-1"
										onClick={resetFilters}
									>
										{t("preparedMedia.resetFilters")}
									</Button>
								) : (
									<Link
										className={buttonStyles(
											"outline",
											"h-auto min-h-9 max-w-full whitespace-normal py-1",
										)}
										to="/directories/root"
									>
										{t("preparedMedia.browseFiles")}
									</Link>
								)
							}
						/>
					)}
				{filtered.length > 0 && (
					<div className="divide-y">
						{groups.map(({ key, title, rows: groupRows }) => {
							const visible = groupRows.filter((row) => rows.has(row));
							if (!visible.length) return null;
							return (
								<section key={key}>
									{title && (
										<h2 className="section-title wrap-anywhere pt-3">
											{title}
										</h2>
									)}
									<ul className="divide-y">
										{visible.map(({ entry, label }) => (
											<OfflineCacheRow
												key={entry.id}
												entry={entry}
												label={label}
												server={server}
												search={locationSearch}
												operation={operations.get(entry.id)}
												perform={(action) => void perform(action, entry.id)}
												onRemove={(event) => {
													removeTrigger.current = event.currentTarget;
													setRemoving(entry);
												}}
											/>
										))}
									</ul>
								</section>
							);
						})}
					</div>
				)}
				{pages > 1 && (
					<div className="border-t pt-4">
						<PaginationControls
							page={page}
							fetching={false}
							hasNextPage={page < pages}
							onPage={(next) => change("page", next === 1 ? "" : String(next))}
							label={t("offlineCache.title")}
						/>
					</div>
				)}
			</div>
			<Dialog
				open={!!removing}
				onOpenChange={(open) => {
					if (!open && !removalPending) setRemoving(undefined);
				}}
			>
				<DialogContent
					showCloseButton={!removalPending}
					initialFocus={cancelRemove}
					finalFocus={() =>
						removeTrigger.current?.isConnected
							? removeTrigger.current
							: searchInput.current
					}
				>
					<DialogHeader>
						<DialogTitle>{t("offlineCache.remove")}</DialogTitle>
						<DialogDescription className="wrap-anywhere">
							{t("offlineCache.removeDescription", {
								name: removing?.name,
								size: size(removing?.sizeBytes ?? 0),
							})}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose
							render={
								<Button
									ref={cancelRemove}
									variant="outline"
									disabled={removalPending}
								/>
							}
						>
							{t("actions.cancel")}
						</DialogClose>
						<CacheActionButton
							icon={Trash2}
							busy={removalPending}
							disabled={removalBlocked}
							onClick={() => void removeSelected()}
						>
							{t("offlineCache.remove")}
						</CacheActionButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
