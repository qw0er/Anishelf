import { ArrowLeft, FileVideo, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LibraryContext } from "../../../App.js";
import type { DirectoryResponse } from "../../../api/contracts.js";
import { buttonStyles } from "../../../components/ui/button.js";
import { Card, CardContent } from "../../../components/ui/card.js";
import { directoryPath, filePath } from "../../../routes/paths.js";
import { MediaLink } from "../../playback/public.js";
import { formatFileSize } from "../format-file-size.js";
import LibraryScan from "./library-scan.js";

export default function LibraryBrowser({
	listing,
	scan,
}: {
	listing: DirectoryResponse;
	scan: LibraryContext;
}) {
	const { t, i18n } = useTranslation();
	const parentId = listing.directory.parentId;
	const setupRequired = scan.settings?.resourceRoot === null;
	return (
		<section className="stack-page" aria-label={t("library.filesLabel")}>
			<LibraryScan {...scan} />
			{!setupRequired && (
				<>
					<div className="flex min-w-0 flex-col gap-4">
						{parentId !== null && (
							<Link
								className={buttonStyles("outline")}
								to={directoryPath(parentId)}
							>
								<ArrowLeft size={16} aria-hidden="true" />
								{t("navigation.parentDirectory")}
							</Link>
						)}
						<h1 className="page-title">
							{t("library.directoryTitle", { name: listing.directory.name })}
						</h1>
					</div>
					<Card>
						<CardContent>
							{listing.children.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{t("library.emptyDirectory")}
								</p>
							) : (
								<ul className="divide-y">
									{listing.children.map((entry) => (
										<li
											key={entry.id}
											className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-2 py-2 first:pt-0 last:pb-0"
										>
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
												<span className="min-w-0 wrap-break-word">
													{entry.name}
												</span>
												{entry.kind === "file" && (
													<span className="col-start-2 text-sm tabular-nums sm:col-start-3 text-muted-foreground">
														{formatFileSize(entry.sizeBytes, i18n.language)}
													</span>
												)}
											</Link>
											{entry.kind === "file" && (
												<MediaLink fileId={entry.id} iconOnly />
											)}
										</li>
									))}
								</ul>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</section>
	);
}
