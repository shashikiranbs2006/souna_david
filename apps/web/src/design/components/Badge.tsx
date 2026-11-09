import type { ReactNode } from 'react';
import { useT, type TKey } from '../../i18n/i18n.ts';
import './Badge.css';

export type BadgeTone = 'solid' | 'outline' | 'soft' | 'dashed' | 'muted';

export function Badge({ tone = 'outline', children, dot }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Single-colour status: weight and fill carry the meaning instead of hues
 * (open states outlined, the one needing action solid, terminal ones muted).
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'solid',
  SUSPENDED: 'dashed',
  DRAFT: 'outline',
  LOCKED: 'soft',
};

export function StatusBadge({ status }: { status: 'ACTIVE' | 'SUSPENDED' | 'DRAFT' | 'LOCKED' }) {
  const { t } = useT();
  return (
    <Badge tone={STATUS_TONE[status] ?? 'outline'} dot>
      {t(`status.${status}` as TKey)}
    </Badge>
  );
}
