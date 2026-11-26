import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { fileReviewsQuery } from "../../../features/anime/public.js";
import {
	FileIdentification,
	FileIdentificationMenu,
} from "../../../features/anime/ui.js";
import { directoryQuery } from "../../../features/resources/public.js";
import {
	LibraryBrowser,
	LibraryScanActions,
} from "../../../features/resources/ui.js";
import { ApiClientError } from "../../../shared/api/client.js";
import type { DirectoryResponse } from "../../../shared/api/contracts.js";
import {
	queryScopeIdentity,
	useQueryScope,
} from "../../../shared/api/queries.js";
import { queryLoadFailure } from "../../../shared/components/load-failure.js";
import { PageHeader } from "../../../shared/components/page-header.js";
import { Button } from "../../../shared/components/ui/button.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { useRefreshError } from "../../../shared/hooks/use-refresh-error.js";
import { FileActions } from "../../components/file-actions.js";
import { useAppRuntime } from "../../runtime/context.js";
import { RouteLoadFailure } from "../errors.js";
export function DirectoryPage() {
	const { id = "root" } = useParams();
	const scope = useQueryScope();
	const { t } = useTranslation();
	const scan = useAppRuntime();
	const query = useQuery({
		...directoryQuery(id, scope),
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === id &&
			queryScopeIdentity(previousQuery.queryKey[1]) ===
				queryScopeIdentity(scope)
				? previous
				: undefined,
	});
	const unavailable =
		query.error instanceof ApiClientError &&
		[403, 404, 410].includes(query.error.status ?? 0);
	const listing = unavailable ? undefined : query.data;
	useRefreshError(
		"directory-refresh",
		listing ? query.error : null,
		query.errorUpdatedAt,
		() => void query.refetch(),
		{ scoped: true },
	);
	if (listing)
		return <DirectoryContents key={listing.directory.id} listing={listing} />;
	const failure = queryLoadFailure(query);
	return (
		<section className="stack-page" aria-label={t("library.filesLabel")}>
			<PageHeader
				title={t("app.files")}
				actions={<LibraryScanActions {...scan} />}
			/>
			<div className="surface-panel space-y-4">
				{failure ? (
					<RouteLoadFailure kind="directory" {...failure} />
				) : (
					<div
						role="status"
						aria-label={t("navigation.loadingFiles")}
						className="space-y-3"
					>
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				)}
			</div>
		</section>
	);
}

function DirectoryContents({ listing }: { listing: DirectoryResponse }) {
	const scan = useAppRuntime();
	const { t } = useTranslation();
	const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
	const ids =
		visibleIds ??
		listing.children
			.filter((entry) => entry.kind === "file")
			.map((entry) => entry.id);
	const reviews = useQuery({
		...fileReviewsQuery(ids, useQueryScope()),
		enabled: ids.length > 0,
	});
	const byFile = new Map(reviews.data?.map((item) => [item.fileId, item]));
	return (
		<LibraryBrowser
			key={listing.directory.id}
			onFileIdsChange={setVisibleIds}
			listing={listing}
			scan={scan}
			identificationStatus={
				reviews.error && (
					<p role="alert">
						{t("anime.identificationLoadFailed")}{" "}
						<Button variant="outline" onClick={() => void reviews.refetch()}>
							{t("actions.retry")}
						</Button>
					</p>
				)
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
