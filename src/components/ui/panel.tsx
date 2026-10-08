import { cn } from "@/lib/utils";

interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Sentence-case heading (14 px, semibold). */
  title?: React.ReactNode;
  /** Secondary line under the title: source, timeframe, units. */
  subtitle?: React.ReactNode;
  /** Right-aligned header slot (a link, a control). */
  action?: React.ReactNode;
  as?: "section" | "div" | "article";
  padded?: boolean;
}

/**
 * The base content block: solid surface, hairline border, 10 px radius.
 * No blur, no gradient, no shadow — hierarchy comes from type and spacing.
 */
export function Panel({ title, subtitle, action, as: Tag = "section", padded = true, className, children, ...rest }: PanelProps) {
  return (
    <Tag className={cn("surface relative min-w-0 overflow-hidden", padded && "p-4 sm:p-5", className)} {...rest}>
      {(title || subtitle || action) && (
        // An unpadded panel (edge-to-edge media) still pads its header to match padded panels.
        <header className={cn("mb-3 flex items-start justify-between gap-3 sm:mb-4", !padded && "px-4 pt-4 sm:px-5 sm:pt-5")}>
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}
