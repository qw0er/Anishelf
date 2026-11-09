import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { toast } from "../../../../shared/components/ui/toast.js";
import { identificationQuery } from "../../metadata/public.js";
import { reidentifyPendingReviews } from "../api.js";
import { reportReviewFailure } from "../feedback.js";

export function ReidentifyAllAction({ disabled }: { disabled: boolean }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const scope = useQueryScope();
	const options = identificationQuery(scope);
	const status = useQuery(options);
	const action = useMutation({
		mutationFn: reidentifyPendingReviews,
		onMutate: () => toast.close("pending-review-reidentification"),
		onError: (error) =>
			reportReviewFailure("pending-review-reidentification", error),
		onSuccess: (value) => client.setQueryData(options.queryKey, value),
	});
	const busy = action.isPending || status.data?.reviewRun?.state === "running";
	return (
		<Button
			variant="outline"
			disabled={disabled || busy}
			aria-busy={busy}
			title={t("review.reidentifyAllHint")}
			onClick={() => action.mutate()}
		>
			<RotateCw
				className={`size-4 ${busy ? "motion-safe:animate-spin" : ""}`}
				aria-hidden="true"
			/>
			{t(busy ? "review.reidentifying" : "review.reidentifyAll")}
		</Button>
	);
}
