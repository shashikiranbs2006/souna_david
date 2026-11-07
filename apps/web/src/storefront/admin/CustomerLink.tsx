import { useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Link2 } from 'lucide-react';
import { api } from '../../api/client.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Select } from '../../design/components/Field.tsx';
import { Button } from '../../design/components/Button.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useAdminMutation } from './helpers.ts';

/**
 * Makes a view-only link for the customer: they see the sauna in 3D with its price, can turn it,
 * open the door and go inside, but cannot change anything. `configurationId` is called when the
 * link is made, so the configurator can save the sauna first.
 */
export function CustomerLinkMaker({ configurationId, invalidate = [], onCreated }: { configurationId: () => Promise<string>; invalidate?: QueryKey[]; onCreated?: (url: string) => void }) {
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api('adminSettings') });
  const [days, setDays] = useState('');
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const expiry = days || String(settings.data?.defaultShareExpiryDays ?? 14);
  const dayOptions = [1, 3, 7, 14, 30, 60, 90].map(d => ({ value: String(d), label: t('staff.days', { count: d }) }));
  if (!dayOptions.some(o => o.value === expiry)) dayOptions.push({ value: expiry, label: t('staff.days', { count: Number(expiry) }) });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast(t('staff.copied'));
    } catch {
      /* the URL stays selectable */
    }
  };
  const create = useAdminMutation(
    async () => {
      const id = await configurationId();
      return { id, link: await api('adminCreateShareLink', { params: { id }, body: { expiresInDays: Number(expiry) } }) };
    },
    {
      invalidate,
      onSuccess: ({ id, link }) => {
        void qc.invalidateQueries({ queryKey: ['admin', 'share-links', id] });
        setCreated({ url: link.url, expiresAt: link.expiresAt });
        setCopied(false);
        void copy(link.url);
        onCreated?.(link.url);
      },
    },
  );

  if (created)
    return (
      <div className="once-box" role="status">
        <p className="once-box__note">{t('admin.configurations.linkOnce')}</p>
        <div className="once-box__url">
          <code className="mono" onClick={e => window.getSelection()?.selectAllChildren(e.currentTarget)}>
            {created.url}
          </code>
          <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copy(created.url)}>
            {t('staff.copy')}
          </Button>
        </div>
        <p className="once-box__note">
          {t('admin.configurations.expires')}: {fmt.date(created.expiresAt)} ·{' '}
          <a href={created.url} target="_blank" rel="noopener noreferrer" className="once-box__open">
            {t('admin.customerLink.open')} <ExternalLink size={12} aria-hidden="true" />
          </a>
        </p>
      </div>
    );
  return (
    <div className="staff-toolbar">
      <Select label={t('admin.configurations.expiresIn')} value={expiry} onChange={e => setDays(e.target.value)} options={dayOptions} />
      <Button icon={Link2} onClick={() => create.mutate(undefined)} loading={create.isPending}>
        {t('admin.customerLink.create')}
      </Button>
    </div>
  );
}
