import { RefreshCw } from "lucide-react";
import {
	Link,
	useRevalidator,
	useRouteError,
	useSearchParams,
} from "react-router";
import { ApiClientError } from "../api/client.js";
import { Button, buttonStyles } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";
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
		<section className="space-y-4" aria-label="Page error">
			<p role="alert">
				{error instanceof ApiClientError
					? error.message
					: "This page could not be loaded."}
			</p>
			<Button
				type="button"
				variant="outline"
				disabled={revalidator.state !== "idle"}
				onClick={() => void revalidator.revalidate()}
			>
				{revalidator.state !== "idle" ? (
					<>
						<Spinner />
						Retrying…
					</>
				) : (
					<>
						<RefreshCw size={16} aria-hidden="true" />{" "}
						{kind === "file" ? "Retry file" : "Retry"}
					</>
				)}
			</Button>{" "}
			<Link
				className={buttonStyles("outline")}
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
