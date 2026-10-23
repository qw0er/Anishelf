import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
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
						? t("acquisition.destination.saved")
						: t("acquisition.destination.validated"),
				type: "success",
			});
		},
		onError: () => {
			void client.invalidateQueries({ queryKey: downloadKeys });
		},
	});
	if (query.isPending)
		return <p role="status">{t("acquisition.destination.loading")}</p>;
	if (query.isError)
		return (
			<p role="alert">
				{t("acquisition.destination.unavailable")}{" "}
				<Button variant="outline" onClick={() => void query.refetch()}>
					{t("actions.retry")}
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
			<h3 className="font-medium">{t("acquisition.destination.title")}</h3>
			<label className="block space-y-2" htmlFor={`${id}-root`}>
				<span className="text-sm">
					{t("acquisition.destination.resourceDirectory")}
				</span>
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
						<option value="">
							{t("acquisition.destination.addDirectoryFirst")}
						</option>
					)}
					{query.data?.roots.map((item) => (
						<option key={item.scopeId} value={item.scopeId}>
							{item.name}
						</option>
					))}
				</select>
			</label>
			<label className="block space-y-2" htmlFor={`${id}-path`}>
				<span className="text-sm">
					{t("acquisition.destination.completedPath")}
				</span>
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
				{t("acquisition.destination.help")}
			</p>
			{destination && (
				<p className="text-sm" role="status">
					{destination.validated
						? destination.visibilityVerified
							? t("acquisition.destination.visibilityVerified")
							: t("acquisition.destination.mappingConfigured")
						: t("acquisition.destination.validationRequired")}
				</p>
			)}
			{action.isError && (
				<p role="alert" className="text-sm">
					{t("acquisition.destination.updateFailed")}
				</p>
			)}
			<div className="action-row">
				<Button
					type="submit"
					disabled={action.isPending || !query.data?.roots.length}
				>
					{t("acquisition.destination.save")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={action.isPending || !destination || changed}
					onClick={() => action.mutate("validate")}
				>
					{t("acquisition.destination.validate")}
				</Button>
			</div>
		</form>
	);
}
