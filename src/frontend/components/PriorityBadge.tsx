import { h } from 'preact';

const LABELS: Record<string, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span class={`priority-badge ${priority}`}>
      {LABELS[priority] ?? priority}
    </span>
  );
}
