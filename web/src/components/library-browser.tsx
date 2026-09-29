import { ArrowLeft, FileVideo, Folder } from "lucide-react";
import { Link } from "react-router";
import type { DirectoryResponse } from "../api/contracts.js";
import { directoryPath, filePath } from "../routes/paths.js";

export default function LibraryBrowser({
	listing,
}: {
	listing: DirectoryResponse;
}) {
	const parentId = listing.directory.parentId;
	return (
		<section className="space-y-2" aria-label="Library files">
			<h2 className="font-semibold">Directory: {listing.directory.name}</h2>
			{parentId !== null && (
				<Link
					className="inline-flex items-center gap-2 border px-3 py-1"
					to={directoryPath(parentId)}
				>
					<ArrowLeft size={16} aria-hidden="true" /> Parent directory
				</Link>
			)}
			{listing.children.length === 0 ? (
				<p>
					This directory is empty. Scan the library to discover video files.
				</p>
			) : (
				<ul className="space-y-2">
					{listing.children.map((entry) => (
						<li key={entry.id}>
							<Link
								className="inline-flex items-center gap-2 border px-3 py-1"
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
								{entry.name}
							</Link>
							{entry.kind === "file" && <span> · {entry.sizeBytes} bytes</span>}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
