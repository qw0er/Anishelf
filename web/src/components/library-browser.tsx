import { ArrowLeft, FileVideo, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LibraryContext } from "../App.js";
import type { DirectoryResponse } from "../api/contracts.js";
import { directoryPath, filePath } from "../routes/paths.js";
import LibraryScan from "./library-scan.js";
import { buttonStyles } from "./ui/button.js";
import { Card, CardContent } from "./ui/card.js";

export default function LibraryBrowser({
	listing,
	scan,
}: {
	listing: DirectoryResponse;
	scan: LibraryContext;
}) {
	const { t } = useTranslation();
	const parentId = listing.directory.parentId;
	const setupRequired = scan.settings?.resourceRoot === null;
	return (
		<section className="space-y-6" aria-label={t("library.filesLabel")}>
			<LibraryScan {...scan} />
			{!setupRequired && (
				<>
					<div className="space-y-3">
						{parentId !== null && (
							<Link
								className={buttonStyles("outline")}
								to={directoryPath(parentId)}
							>
								<ArrowLeft size={16} aria-hidden="true" />
								{t("navigation.parentDirectory")}
							</Link>
						)}
						<h1 className="wrap-break-word text-2xl font-semibold">
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
										<li key={entry.id} className="py-2 first:pt-0 last:pb-0">
											<Link
												aria-label={entry.name}
												className="flex min-w-0 items-center gap-3 rounded-md p-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
												to={
													entry.kind === "directory"
														? directoryPath(entry.id)
														: filePath(entry.id, listing.directory.id)
												}
											>
												{entry.kind === "directory" ? (
													<Folder size={16} aria-hidden="true" />
												) : (
													<FileVideo size={16} aria-hidden="true" />
												)}
												<span className="min-w-0 flex-1 wrap-break-word">
													{entry.name}
												</span>
												{entry.kind === "file" && (
													<span className="shrink-0 text-sm text-muted-foreground">
														{t("library.bytes", {
															count: entry.sizeBytes,
														})}
													</span>
												)}
											</Link>
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
