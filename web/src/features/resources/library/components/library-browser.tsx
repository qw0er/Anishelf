import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileVideo, Folder } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import type {
	DirectoryResponse,
	ResourceCommand,
	ResourceDto,
} from "../../../../shared/api/contracts.js";
import {
	boundedSignal,
	useQueryScope,
} from "../../../../shared/api/queries.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import { buttonStyles } from "../../../../shared/components/ui/button.js";
import { Card, CardContent } from "../../../../shared/components/ui/card.js";
import { Input } from "../../../../shared/components/ui/input.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../../shared/components/ui/native-select.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { directoryPath, filePath } from "../../../../shared/navigation.js";
import {
	summariesQuery,
	useDirectoryCompatibility,
} from "../../../media/public.js";
import type { FileActionSlot } from "../../public.js";
import { searchDirectory } from "../api.js";
import { formatFileSize } from "../format-file-size.js";
import type { LibraryScanState } from "../public.js";
import LibraryScan, { LibraryScanActions } from "./library-scan.js";

import {
	ResourceOperationDialog,
	ResourceOperationItems,
	ResourceOperationMenu,
} from "./resource-operations.js";

export default function LibraryBrowser({
	listing,
	scan,
	renderFileActions,
	identificationStatus,
	onFileIdsChange,
}: {
	listing: DirectoryResponse;
	scan: LibraryScanState;
	renderFileActions?: FileActionSlot;
	identificationStatus?: ReactNode;
	onFileIdsChange?: (ids: string[]) => void;
}) {
	const { t, i18n } = useTranslation();
	const [operation, setOperation] = useState<{
		entry: ResourceDto;
		action: ResourceCommand["action"];
	} | null>(null);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [sort, setSort] = useState("default");
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
		return () => clearTimeout(timer);
	}, [search]);
	const { hash } = useLocation();
	const focusedRow = useRef<HTMLLIElement>(null);
	useEffect(() => {
		if (!hash || !focusedRow.current) return;
		focusedRow.current.scrollIntoView?.({ block: "center" });
		focusedRow.current.focus({ preventScroll: true });
	}, [hash]);
	const parentId = listing.directory.parentId;
	const scope = useQueryScope();
	const term = search.trim();
	const searchQuery = useQuery({
		queryKey: [
			"directory-search",
			scope,
			scan.library?.revision,
			listing.directory.id,
			debouncedSearch,
		],
		queryFn: ({ signal }) =>
			searchDirectory(listing.directory.id, debouncedSearch, {
				signal: boundedSignal(signal),
			}),
		enabled: Boolean(debouncedSearch) && debouncedSearch === term,
	});
	const searching =
		Boolean(term) && (term !== debouncedSearch || searchQuery.isPending);
	const results =
		term && term === debouncedSearch ? searchQuery.data?.items : undefined;
	const visibleListing = {
		...listing,
		children: term
			? (results?.map((item) => item.resource) ?? [])
			: listing.children,
	};
	const paths = new Map(
		results?.map(({ resource, parentPath }) => [resource.id, parentPath]) ?? [],
	);
	const ids = visibleListing.children
		.filter((entry) => entry.kind === "file")
		.map((file) => file.id);
	const idsKey = JSON.stringify(ids);
	useEffect(() => {
		onFileIdsChange?.(JSON.parse(idsKey) as string[]);
	}, [idsKey, onFileIdsChange]);
	const summaries = useQuery({
		...summariesQuery(scope, ids),
		enabled: ids.length > 0,
	});
	const compatibility = useDirectoryCompatibility(
		visibleListing,
		JSON.stringify([scan.settings?.resourceRoots, scan.library?.revision]),
	);
	const setupRequired = scan.settings?.resourceRoots.length === 0;
	const children = [...visibleListing.children];
	if (sort !== "default") {
		children.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
			if (sort === "name-desc") return 0; // Reversed within each group below.
			if (a.kind === "directory" || b.kind === "directory") return 0;
			if (sort === "size-asc") return a.sizeBytes - b.sizeBytes;
			if (sort === "size-desc") return b.sizeBytes - a.sizeBytes;
			if (sort === "modified-asc")
				return a.modifiedAt.localeCompare(b.modifiedAt);
			if (sort === "modified-desc")
				return b.modifiedAt.localeCompare(a.modifiedAt);
			return 0;
		});
		if (sort === "name-desc") {
			const directories = children
				.filter((entry) => entry.kind === "directory")
				.reverse();
			const files = children.filter((entry) => entry.kind === "file").reverse();
			children.splice(0, children.length, ...directories, ...files);
		}
	}
	return (
		<section className="stack-page" aria-label={t("library.filesLabel")}>
			<PageHeader
				title={t("app.files")}
				description={t("library.directoryTitle", {
					name: listing.directory.name,
				})}
				actions={
					<>
						<LibraryScanActions {...scan} />
						{parentId !== null && (
							<Link
								className={buttonStyles("outline")}
								to={directoryPath(parentId)}
							>
								<ArrowLeft size={16} aria-hidden="true" />
								{t("navigation.parentDirectory")}
							</Link>
						)}
					</>
				}
			/>
			<LibraryScan {...scan} />
			{operation && (
				<ResourceOperationDialog
					key={`${operation.entry.id}:${operation.action}`}
					{...operation}
					onClose={() => setOperation(null)}
				/>
			)}
			{identificationStatus}
			{!setupRequired && (
				<div className="space-y-4">
					<div className="flex flex-col gap-2 border-b pb-4 sm:flex-row">
						<Input
							type="search"
							aria-label={t("library.search")}
							placeholder={t("library.search")}
							maxLength={200}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
						<div className="sm:w-60 sm:shrink-0">
							<NativeSelect
								aria-label={t("library.sort")}
								value={sort}
								onChange={(event) => setSort(event.target.value)}
							>
								{[
									"default",
									"name-desc",
									"size-asc",
									"size-desc",
									"modified-asc",
									"modified-desc",
								].map((option) => (
									<NativeSelectOption key={option} value={option}>
										{t(`library.sortOptions.${option}`)}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>
					</div>
					<Card
						className={
							listing.children.length === 0
								? "border-0 bg-transparent py-0"
								: undefined
						}
					>
						<CardContent
							className={listing.children.length === 0 ? "px-0" : undefined}
						>
							{searching ? (
								<p role="status">{t("library.searching")}</p>
							) : term && searchQuery.isError ? (
								<p role="alert">
									{t("library.searchFailed")}{" "}
									<button
										type="button"
										className="underline"
										onClick={() => void searchQuery.refetch()}
									>
										{t("actions.retry")}
									</button>
								</p>
							) : !term && listing.children.length === 0 ? (
								<EmptyState
									icon={<Folder size={24} />}
									title={t("library.emptyDirectory")}
								/>
							) : children.length === 0 ? (
								<EmptyState
									icon={<Folder size={24} />}
									title={t("library.noSearchResults")}
								/>
							) : (
								<ul className="divide-y">
									{children.map((entry) => (
										<li
											key={entry.id}
											id={`file-${entry.id}`}
											ref={
												hash === `#${encodeURIComponent(`file-${entry.id}`)}`
													? focusedRow
													: undefined
											}
											tabIndex={-1}
											className="grid scroll-mt-4 grid-cols-[minmax(0,1fr)_auto] items-center py-2 first:pt-0 last:pb-0 target:rounded-md target:bg-accent target:ring-2 target:ring-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
										>
											<Tooltip content={entry.name}>
												<Link
													aria-label={entry.name}
													className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-md px-2 py-3 sm:grid-cols-[1rem_minmax(0,1fr)_auto] hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
													to={
														entry.kind === "directory"
															? directoryPath(entry.id)
															: filePath(entry.id, entry.parentId)
													}
												>
													{entry.kind === "directory" ? (
														<Folder
															className="mt-1 self-start"
															size={16}
															aria-hidden="true"
														/>
													) : (
														<FileVideo
															className="mt-1 self-start"
															size={16}
															aria-hidden="true"
														/>
													)}
													<span className="min-w-0">
														<span className="block truncate">{entry.name}</span>
														{Boolean(paths.get(entry.id)?.length) && (
															<span className="block truncate text-sm text-muted-foreground">
																{paths.get(entry.id)?.join(" / ")}
															</span>
														)}
													</span>
													{entry.kind === "file" && (
														<span className="col-start-2 text-sm tabular-nums sm:col-start-3 text-muted-foreground">
															{formatFileSize(entry.sizeBytes, i18n.language)}
														</span>
													)}
												</Link>
											</Tooltip>
											{entry.kind === "directory" &&
												!(
													listing.directory.id === "root" &&
													entry.parentId === "root" &&
													(scan.library?.roots?.length ?? 0) > 1
												) && (
													<ResourceOperationMenu
														onSelect={(action) =>
															setOperation({ entry, action })
														}
													/>
												)}
											{entry.kind === "file" && (
												<div className="flex items-center justify-end gap-1 pl-2">
													{renderFileActions?.({
														fileId: entry.id,
														managementMenu: (
															<ResourceOperationItems
																onSelect={(action) =>
																	setOperation({ entry, action })
																}
															/>
														),
														summary: summaries.data?.files.find(
															(file) => file.fileId === entry.id,
														),
														...compatibility.get(entry.id),
														onRecheck: compatibility.retry,
													})}
												</div>
											)}
										</li>
									))}
								</ul>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</section>
	);
}
