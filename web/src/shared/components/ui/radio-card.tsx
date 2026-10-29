import { type ReactNode, useId } from "react";
import { cn } from "../../lib/utils.js";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";
import { StatusBadge } from "./status-badge.js";

export function RadioCardGroup({
	legend,
	className,
	children,
	...props
}: {
	legend: ReactNode;
	className?: string;
	children: ReactNode;
	name: string;
	value: string;
	onValueChange(value: string): void;
	disabled?: boolean;
}) {
	const id = useId();
	return (
		<div className="space-y-2">
			<div id={id} className="text-sm font-medium">
				{legend}
			</div>
			<RadioGroup {...props} aria-labelledby={id} className={className}>
				{children}
			</RadioGroup>
		</div>
	);
}

export function RadioCard({
	value,
	disabled,
	className,
	title,
	meta,
	badge,
	description,
}: {
	value: string;
	disabled?: boolean;
	className?: string;
	title: ReactNode;
	meta?: ReactNode;
	badge?: ReactNode;
	description?: ReactNode;
}) {
	const id = useId();
	return (
		<label
			htmlFor={id}
			className={cn(
				"touch-control flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-accent/50 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-50",
				className,
			)}
		>
			<RadioGroupItem
				id={id}
				value={value}
				disabled={disabled}
				className="mt-1 after:hidden"
			/>
			<span className="min-w-0">
				<span className="flex flex-wrap items-center gap-2 text-sm font-medium">
					{title}
					{badge && <StatusBadge>{badge}</StatusBadge>}
				</span>
				{meta && (
					<span className="block text-xs text-muted-foreground">{meta}</span>
				)}
				{description && (
					<span className="mt-1 block text-xs text-muted-foreground">
						{description}
					</span>
				)}
			</span>
		</label>
	);
}
