import { RefreshCw } from "lucide-react";
import {
	Link,
	useRevalidator,
	useRouteError,
	useSearchParams,
} from "react-router";
import { ApiClientError } from "../api/client.js";
import { directoryPath } from "./paths.js";

export default function RouteError({
	kind,
}: {
	kind: "directory" | "file" | "page";
}) {
	const error = useRouteError();
	const revalidator = useRevalidator();
	const [searchParams] = useSearchParams();
	return (
		<section className="space-y-2" aria-label="Page error">
			<p role="alert">
				{error instanceof ApiClientError
					? error.message
					: "This page could not be loaded."}
			</p>
			<button
				type="button"
				className="inline-flex items-center gap-2 border px-3 py-1"
				disabled={revalidator.state !== "idle"}
				onClick={() => void revalidator.revalidate()}
			>
				<RefreshCw size={16} aria-hidden="true" />{" "}
				{kind === "file" ? "Retry file" : "Retry"}
			</button>{" "}
			<Link
				className="border px-3 py-1"
				to={
					kind === "file"
						? directoryPath(searchParams.get("directory") || "root")
						: "/"
				}
			>
				{kind === "file" ? "Back to files" : "Go to root"}
			</Link>
		</section>
	);
}
