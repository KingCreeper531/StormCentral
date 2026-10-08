import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-canvas hover:opacity-90",
  secondary: "bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-strong",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "text-ink-2 hover:bg-nogo/15 hover:text-nogo",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Rectangular button. Grows to a 44 px touch target on coarse pointers. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 pointer-coarse:min-h-11",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
});

/** Square icon-only button; `label` is required for screen readers. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "children"> & { label: string; children: React.ReactNode }>(
  function IconButton({ label, variant = "ghost", size = "md", className, children, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        aria-label={label}
        title={label}
        className={cn(size === "sm" ? "w-8 px-0" : "w-9 px-0", "pointer-coarse:min-w-11", className)}
        {...rest}
      >
        {children}
      </Button>
    );
  },
);

/** Shared look for anchors that should read as buttons. */
export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-medium whitespace-nowrap transition-colors pointer-coarse:min-h-11",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
