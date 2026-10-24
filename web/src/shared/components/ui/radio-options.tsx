import { useId } from "react";
import { cn } from "../../lib/utils.js";

/** Short, finite choices stay visible; descriptive choices use RadioCard instead. */
export function RadioOptions<T extends string>({
	legend,
	value,
	options,
	onChange,
	disabled,
	className,
}: {
	legend: string;
	value: T;
	options: readonly { value: T; label: string }[];
	onChange(value: T): void;
	disabled?: boolean;
	className?: string;
}) {
	const name = useId();
	return (
		<fieldset
			disabled={disabled}
			className={cn("min-w-0 space-y-2", className)}
		>
			<legend className="text-sm font-medium">{legend}</legend>
			<div className="flex flex-wrap gap-x-4 gap-y-2">
				{options.map((option) => (
					<label
						key={option.value}
						className="flex cursor-pointer items-center gap-2 text-sm has-[:disabled]:opacity-50"
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
							className="accent-primary"
						/>
						{option.label}
					</label>
				))}
			</div>
		</fieldset>
	);
}
