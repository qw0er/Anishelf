import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLoaderData, useParams } from "react-router";
import { fileReviewsQuery } from "../../../features/anime/public.js";
import {
	FileIdentification,
	FileIdentificationMenu,
	IdentificationStatus,
} from "../../../features/anime/ui.js";
import { directoryQuery } from "../../../features/resources/public.js";
import { LibraryBrowser } from "../../../features/resources/ui.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { Button } from "../../../shared/components/ui/button.js";
import { FileActions } from "../../components/file-actions.js";
import { useAppRuntime } from "../../runtime/context.js";
import type { directoryLoader } from "../resources-data.js";
export function DirectoryPage() {
	const initial = useLoaderData<typeof directoryLoader>();
	const { id } = useParams();
	const query = useQuery({
		...directoryQuery(id ?? "root", useQueryScope()),
	});
	const listing = query.data ?? initial;
	const scan = useAppRuntime();
	const { t } = useTranslation();
	const ids = listing.children
		.filter((entry) => entry.kind === "file")
		.map((entry) => entry.id);
	const reviews = useQuery({
		...fileReviewsQuery(ids, useQueryScope()),
		enabled: ids.length > 0,
	});
	const byFile = new Map(reviews.data?.map((item) => [item.fileId, item]));
	if (query.error && !query.data) throw query.error;
	return (
		<LibraryBrowser
			listing={listing}
			scan={scan}
			identificationStatus={
				<>
					<IdentificationStatus />
					{reviews.error && (
						<p role="alert">
							{t("anime.identificationLoadFailed")}{" "}
							<Button variant="outline" onClick={() => void reviews.refetch()}>
								{t("actions.retry")}
							</Button>
						</p>
					)}
				</>
			}
			renderFileActions={(state) => (
				<FileActions
					{...state}
					identification={
						reviews.data ? (
							<FileIdentification item={byFile.get(state.fileId)} />
						) : undefined
					}
					identificationMenu={
						<FileIdentificationMenu item={byFile.get(state.fileId)} />
					}
				/>
			)}
		/>
	);
}
