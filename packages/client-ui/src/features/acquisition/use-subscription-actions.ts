import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SubscriptionView } from "../../shared/api/contracts.js";
import { toast } from "../../shared/components/ui/toast.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { downloadKeys } from "./downloads-api.js";
import {
	refreshSubscription,
	removeSubscription,
	type SubscriptionListItem,
	toggleSubscription,
} from "./subscriptions-api.js";
import { watchingKey } from "./watching-api.js";

export function useSubscriptionActions({
	workKey,
	subscription: sub,
	inventory,
	onEditorClose,
}: {
	workKey: string;
	subscription: SubscriptionView["subscription"] | undefined;
	inventory: boolean;
	onEditorClose(): void;
}) {
	const client = useQueryClient();
	const { t } = useTranslation();
	const updated = async (result?: SubscriptionView) => {
		await client.cancelQueries({
			queryKey: ["anime-status"],
			predicate: (query) => query.queryKey[2] === workKey,
		});
		if (result)
			client.setQueriesData<
				import("../../shared/api/contracts.js").AnimeStatusResponse
			>(
				{
					queryKey: ["anime-status"],
					predicate: (query) => query.queryKey[2] === workKey,
				},
				(previous) =>
					previous
						? {
								...previous,
								subscription: { subscription: result.subscription },
							}
						: undefined,
			);
		if (inventory && result) {
			await client.cancelQueries({
				queryKey: ["acquisition", "subscription", "list"],
			});
			client.setQueryData<SubscriptionListItem[]>(
				["acquisition", "subscription", "list"],
				(previous) =>
					previous?.flatMap((item) =>
						item.view.subscription?.workKey === workKey
							? result.subscription
								? [{ ...item, view: result }]
								: []
							: [item],
					),
			);
		}
		onEditorClose();
		void client.invalidateQueries({
			queryKey: ["acquisition", "subscription", "list"],
		});
		void client.invalidateQueries({
			queryKey: ["acquisition", "subscription", workKey],
		});
		void client.invalidateQueries({ queryKey: [...downloadKeys, workKey] });
		void client.invalidateQueries({ queryKey: watchingKey });
		void invalidateAnimeQueries(client, "acquisition", workKey);
	};
	const action = useMutation({
		mutationFn: async (command: "toggle" | "refresh" | "remove") => {
			if (!sub) return;
			if (command === "toggle")
				return toggleSubscription(
					workKey,
					sub.revision,
					sub.runState === "completed" || !sub.enabled,
				);
			if (command === "refresh")
				return refreshSubscription(workKey, sub.revision);
			await removeSubscription(workKey, sub.revision);
			return {
				subscription: null,
				candidates: [],
				total: 0,
				page: 1,
			} satisfies SubscriptionView;
		},
		onSuccess: async (result, command) => {
			console.info("[acquisition] Subscription command completed.", {
				workKey,
				command,
			});
			await updated(result);
			toast.add({
				type: "success",
				title: t("acquisition.subscription.updated"),
			});
		},
		onError: (_error, command) => {
			console.warn("[acquisition] Subscription command failed.", {
				workKey,
				command,
			});
			updated();
			toast.add({
				type: "error",
				title: t("acquisition.subscription.updateFailed"),
			});
		},
	});
	return { action, updated };
}
