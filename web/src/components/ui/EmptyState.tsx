import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon: Icon = Inbox, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Icon size={48} aria-hidden className="text-muted" />
      <p className="text-lg font-semibold">{title}</p>
      {description && <p className="text-muted max-w-prose">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
