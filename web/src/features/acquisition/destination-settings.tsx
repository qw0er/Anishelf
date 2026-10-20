import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { boundedSignal } from "../../shared/api/queries.js";
import { Button } from "../../shared/components/ui/button.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
import {
	downloadKeys,
	getDownloadSettings,
	saveDownloadDestination,
	validateDownloadDestination,
} from "./downloads-api.js";
export function DownloadDestinationSettings() {
	const id = useId(),
		client = useQueryClient();
	const query = useQuery({
		queryKey: [...downloadKeys, "settings"],
		queryFn: ({ signal }) =>
			getDownloadSettings({ signal: boundedSignal(signal) }),
	});
	const [root, setRoot] = useState<string | null>(null),
		[path, setPath] = useState<string | null>(null);
	const destination = query.data?.destination;
	const changed = root !== null || path !== null;
	const action = useMutation({
		mutationFn: async (kind: "save" | "validate") => {
			if (kind === "validate") {
				if (!destination) throw new Error("Save a destination first.");
				return validateDownloadDestination(destination.revision);
			}
			return saveDownloadDestination({
				revision: destination?.revision ?? null,
				scopeId:
					root ?? destination?.scopeId ?? query.data?.roots[0]?.scopeId ?? "",
				path: path ?? destination?.path ?? "/data/media",
			});
		},
		onSuccess: (_, kind) => {
			setRoot(null);
			setPath(null);
			void client.invalidateQueries({ queryKey: downloadKeys });
			toast.add({
				title:
					kind === "save"
						? "Download destination saved."
						: "Destination validated. Shared files are verified during import.",
				type: "success",
			});
		},
		onError: () => {
			void client.invalidateQueries({ queryKey: downloadKeys });
		},
	});
	if (query.isPending)
		return <p role="status">Loading download destination…</p>;
	if (query.isError)
		return (
			<p role="alert">
				Download destination unavailable.{" "}
				<Button variant="outline" onClick={() => void query.refetch()}>
					Retry
				</Button>
			</p>
		);
	return (
		<form
			className="space-y-3 border-t pt-4"
			onSubmit={(event) => {
				event.preventDefault();
				action.mutate("save");
			}}
		>
			<h3 className="font-medium">Download destination</h3>
			<label className="block space-y-2" htmlFor={`${id}-root`}>
				<span className="text-sm">Resource directory</span>
				<select
					className="h-9 w-full rounded-md border bg-background px-3 text-sm"
					id={`${id}-root`}
					required
					disabled={action.isPending}
					value={
						root ?? destination?.scopeId ?? query.data?.roots[0]?.scopeId ?? ""
					}
					onChange={(event) => setRoot(event.target.value)}
				>
					{!query.data?.roots.length && (
						<option value="">Add a resource directory first</option>
					)}
					{query.data?.roots.map((item) => (
						<option key={item.scopeId} value={item.scopeId}>
							{item.name}
						</option>
					))}
				</select>
			</label>
			<label className="block space-y-2" htmlFor={`${id}-path`}>
				<span className="text-sm">qBittorrent completed path</span>
				<Input
					id={`${id}-path`}
					required
					maxLength={2048}
					value={path ?? destination?.path ?? "/data/media"}
					onChange={(event) => setPath(event.target.value)}
					disabled={action.isPending}
				/>
			</label>
			<p className="text-sm text-muted-foreground">
				Each anime gets its own folder. Enable a separate incomplete directory
				in qBittorrent. Saving a destination requires subscriptions to be
				confirmed again.
			</p>
			{destination && (
				<p className="text-sm" role="status">
					{destination.validated
						? destination.visibilityVerified
							? "Shared file visibility verified"
							: "Mapping configured · File visibility not yet verified"
						: "Validation required"}
				</p>
			)}
			{action.isError && (
				<p role="alert" className="text-sm">
					Could not update the destination. Check the API connection, resource
					directory and incomplete directory settings, then retry.
				</p>
			)}
			<div className="action-row">
				<Button
					type="submit"
					disabled={action.isPending || !query.data?.roots.length}
				>
					Save destination
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={action.isPending || !destination || changed}
					onClick={() => action.mutate("validate")}
				>
					Validate destination
				</Button>
			</div>
		</form>
	);
}
