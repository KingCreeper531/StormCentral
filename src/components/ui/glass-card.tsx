import { cn } from "@/lib/utils";

interface GlassCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  as?: "section" | "div" | "article";
  padded?: boolean;
}

export function GlassCard({ title, eyebrow, action, as: Tag = "section", padded = true, className, children, ...rest }: GlassCardProps) {
  return (
    <Tag className={cn("glass relative min-w-0 overflow-hidden rounded-[var(--radius-pane)]", padded && "p-5", className)} {...rest}>
      {(title || eyebrow || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <p className="text-[11px] font-medium tracking-[0.14em] text-ink-3 uppercase">{eyebrow}</p>}
            {title && <h2 className="mt-0.5 truncate text-[15px] font-semibold text-ink">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </Tag>
  );
}
