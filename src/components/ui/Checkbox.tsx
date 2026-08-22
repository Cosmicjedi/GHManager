"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/format";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked"> {
  checked: boolean;
  /** Renders the dash state used by a partially selected "select all" box. */
  indeterminate?: boolean;
  label: string;
}

export function Checkbox({
  checked,
  indeterminate = false,
  label,
  className,
  disabled,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  // `indeterminate` only exists as a DOM property, never as an attribute.
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "size-4 cursor-pointer rounded border-border-strong accent-[var(--accent)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
