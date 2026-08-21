"use client";

import { forwardRef } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg border border-transparent hover:bg-accent-hover disabled:hover:bg-accent",
  secondary:
    "bg-surface text-fg border border-border-strong hover:bg-surface-muted disabled:hover:bg-surface",
  ghost:
    "bg-transparent text-fg-muted border border-transparent hover:bg-surface-muted hover:text-fg disabled:hover:bg-transparent",
  danger:
    "bg-danger text-white border border-transparent hover:opacity-90 disabled:hover:opacity-100",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size={size === "sm" ? 13 : 15} /> : null}
      {children}
    </button>
  );
});
