import { useQuery } from "@tanstack/react-query";
import { useLoaderData, useParams } from "react-router";
import { directoryQuery } from "../../../features/resources/public.js";
import { LibraryBrowser } from "../../../features/resources/ui.js";
import { useQueryScope } from "../../../shared/api/queries.js";
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
	if (query.error && !query.data) throw query.error;
	return (
		<LibraryBrowser
			listing={listing}
			scan={scan}
			renderFileActions={(state) => <FileActions {...state} />}
		/>
	);
}
