"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/format";

const CONTROL_CLASSES =
  "h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg " +
  "placeholder:text-fg-subtle transition-colors hover:border-border-strong " +
  "focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-55";

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Hide the visual label but keep it for assistive technology. */
  labelHidden?: boolean;
  leading?: React.ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, labelHidden = false, leading, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className={cn(
          "mb-1.5 block text-sm font-medium text-fg",
          labelHidden && "sr-only",
        )}
      >
        {label}
      </label>
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-subtle">
            {leading}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL_CLASSES, leading && "pl-9", error && "border-danger", className)}
          {...props}
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  labelHidden?: boolean;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, labelHidden = false, options, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="w-full">
      <label
        htmlFor={selectId}
        className={cn("mb-1.5 block text-sm font-medium text-fg", labelHidden && "sr-only")}
      >
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        className={cn(CONTROL_CLASSES, "cursor-pointer pr-8", className)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
});
