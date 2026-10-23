import type { ChangeEventHandler, ReactNode } from "react";
import { cn } from "../../lib/utils.js";

export function RadioCardGroup({
	legend,
	disabled,
	className,
	children,
}: {
	legend: ReactNode;
	disabled?: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<fieldset className={cn("space-y-2", className)} disabled={disabled}>
			<legend className="mb-2 text-sm font-medium">{legend}</legend>
			{children}
		</fieldset>
	);
}

export function RadioCard({
	name,
	value,
	checked,
	onChange,
	disabled,
	className,
	title,
	meta,
	badge,
	description,
}: {
	name: string;
	value?: string;
	checked: boolean;
	onChange?: ChangeEventHandler<HTMLInputElement>;
	disabled?: boolean;
	className?: string;
	title: ReactNode;
	meta?: ReactNode;
	badge?: ReactNode;
	description?: ReactNode;
}) {
	return (
		<label
			className={cn(
				"flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
				className,
			)}
		>
			<input
				type="radio"
				name={name}
				value={value}
				checked={checked}
				onChange={onChange}
				disabled={disabled}
				className="mt-1 accent-primary"
			/>
			<span className="min-w-0">
				<span className="flex flex-wrap items-center gap-2 text-sm font-medium">
					{title}
					{badge && (
						<span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
							{badge}
						</span>
					)}
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
