import { useTranslation } from "react-i18next";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Checkbox } from "../../../../shared/components/ui/checkbox.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../../shared/components/ui/collapsible.js";
import { FieldLabel } from "../../../../shared/components/ui/field.js";
import { Input } from "../../../../shared/components/ui/input.js";
import { ErrorMessage } from "../../shared/components/error-message.js";
import type { ReviewController } from "../use-review-controller.js";

export function RejectionPanel({
	item,
	controller,
}: {
	item: CatalogReviewItem;
	controller: Pick<
		ReviewController,
		| "busy"
		| "decisionValidation"
		| "decisionError"
		| "clearDecisionValidation"
		| "requestDecision"
	>;
}) {
	const { t } = useTranslation();
	const {
		busy,
		decisionValidation,
		decisionError,
		clearDecisionValidation,
		requestDecision,
	} = controller;
	const existing = item.associations;
	return (
		<Collapsible className="rounded-lg border p-4 text-sm">
			<CollapsibleTrigger className="cursor-pointer font-medium text-muted-foreground">
				{t(existing.length ? "review.removeAction" : "review.reject")}
			</CollapsibleTrigger>
			<CollapsibleContent keepMounted>
				<p className="mt-3 text-xs leading-relaxed text-muted-foreground">
					{t("review.rejectHint")}
				</p>
				<form
					className="mt-4 space-y-3"
					onChange={() => clearDecisionValidation()}
					onSubmit={(event) => {
						event.preventDefault();
						requestDecision(new FormData(event.currentTarget));
					}}
				>
					<label
						htmlFor="rejection-reason"
						className="block space-y-1.5 text-sm"
					>
						{t(
							existing.length
								? "review.rejectionReason"
								: "review.optionalRejectionReason",
						)}
						<Input
							id="rejection-reason"
							name="reason"
							maxLength={500}
							required={existing.length > 0}
						/>
					</label>
					{existing.length > 0 && (
						<div className="touch-control flex items-start gap-2 text-xs leading-relaxed">
							<Checkbox id="remove-association" name="remove" />
							<FieldLabel
								className="touch-control flex-1"
								htmlFor="remove-association"
							>
								{t("review.remove")}
							</FieldLabel>
						</div>
					)}
					<Button
						className="w-full text-destructive"
						type="submit"
						variant="outline"
						disabled={busy}
					>
						{t(existing.length ? "review.removeAction" : "review.reject")}
					</Button>
				</form>
				{decisionValidation && (
					<p role="alert" className="mt-3 text-sm text-destructive">
						{decisionValidation}
					</p>
				)}
				{decisionError && <ErrorMessage error={decisionError} />}
			</CollapsibleContent>
		</Collapsible>
	);
}
