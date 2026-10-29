import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileVideo, Folder } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import type { DirectoryResponse } from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import { buttonStyles } from "../../../../shared/components/ui/button.js";
import { Card, CardContent } from "../../../../shared/components/ui/card.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { directoryPath, filePath } from "../../../../shared/navigation.js";
import {
	summariesQuery,
	useDirectoryCompatibility,
} from "../../../media/public.js";
import type { FileActionSlot } from "../../public.js";
import { formatFileSize } from "../format-file-size.js";
import type { LibraryScanState } from "../public.js";
import LibraryScan, { LibraryScanActions } from "./library-scan.js";

export default function LibraryBrowser({
	listing,
	scan,
	renderFileActions,
	identificationStatus,
}: {
	listing: DirectoryResponse;
	scan: LibraryScanState;
	renderFileActions?: FileActionSlot;
	identificationStatus?: ReactNode;
}) {
	const { t, i18n } = useTranslation();
	const { hash } = useLocation();
	const focusedRow = useRef<HTMLLIElement>(null);
	useEffect(() => {
		if (!hash || !focusedRow.current) return;
		focusedRow.current.scrollIntoView?.({ block: "center" });
		focusedRow.current.focus({ preventScroll: true });
	}, [hash]);
	const parentId = listing.directory.parentId;
	const ids = listing.children
		.filter((entry) => entry.kind === "file")
		.map((file) => file.id);
	const summaries = useQuery({
		...summariesQuery(useQueryScope(), ids),
		enabled: ids.length > 0,
	});
	const compatibility = useDirectoryCompatibility(
		listing,
		JSON.stringify([scan.settings?.resourceRoots, scan.library?.revision]),
	);
	const setupRequired = scan.settings?.resourceRoots.length === 0;
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
			{identificationStatus}
			{!setupRequired && (
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
						{listing.children.length === 0 ? (
							<EmptyState
								icon={<Folder size={24} />}
								title={t("library.emptyDirectory")}
							/>
						) : (
							<ul className="divide-y">
								{listing.children.map((entry) => (
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
														: filePath(entry.id, listing.directory.id)
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
												<span className="min-w-0 truncate">{entry.name}</span>
												{entry.kind === "file" && (
													<span className="col-start-2 text-sm tabular-nums sm:col-start-3 text-muted-foreground">
														{formatFileSize(entry.sizeBytes, i18n.language)}
													</span>
												)}
											</Link>
										</Tooltip>
										{entry.kind === "file" && (
											<div className="flex items-center justify-end gap-1 pl-2">
												{renderFileActions?.({
													fileId: entry.id,
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
			)}
		</section>
	);
}
