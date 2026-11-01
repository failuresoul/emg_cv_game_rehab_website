import type { LucideIcon } from "lucide-react";

import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
}

export function StatCard({ label, value, icon: Icon, hint }: StatCardProps) {
  return (
    <Card className="flex items-start justify-between gap-4">
      <div>
        <p className="text-muted">{label}</p>
        <p className="mt-1 text-3xl font-bold">{value}</p>
        {hint && <p className="text-muted mt-1 text-sm">{hint}</p>}
      </div>
      {Icon && <Icon size={28} aria-hidden className="text-primary shrink-0" />}
    </Card>
  );
}
