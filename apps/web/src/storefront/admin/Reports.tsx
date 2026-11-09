import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Table, type Column } from '../../design/components/Table.tsx';
import { Badge } from '../../design/components/Badge.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { HBarList, StatGrid, StatTile } from '../../staff/charts.tsx';

type OfferSummary = ResponseOf<'adminOffers'>['items'][number];

/** All quotes (newest version of each number), or only those still waiting for an answer. */
export function QuotesList() {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const open = params.get('open') === '1';
  useDocumentTitle(t('admin.nav.quotes'));
  const list = useQuery({ queryKey: ['admin', 'offers', { open }], queryFn: () => api('adminOffers', { query: open ? { open: '1' } : {} }) });
  const columns: Column<OfferSummary>[] = [
    {
      key: 'q', header: t('admin.contacts.quotes'),
      cell: o => (
        <Link to={`/admin/offers/${o.id}`} className="row-link">
          <span className="staff-strong">{o.label}</span>
          <span className="staff-sub">{o.configuration.name}</span>
        </Link>
      ),
    },
    { key: 'c', header: t('admin.nav.contacts'), cell: o => o.contact.personName, hideOnMobile: true },
    { key: 's', header: t('staff.status'), cell: o => <Badge tone={o.status === 'ACCEPTED' ? 'outline' : 'muted'}>{t(`admin.contacts.status.${o.status}` as TKey)}</Badge> },
    { key: 'o', header: t('admin.contacts.opens'), align: 'end', cell: o => <span className="mono">{o.opens > 0 ? `${o.opens}${o.lastOpenedAt ? ' · ' + fmt.date(o.lastOpenedAt, 'short') : ''}` : '–'}</span>, sortValue: o => o.opens, hideOnMobile: true },
    { key: 'd', header: t('admin.contacts.since'), align: 'end', cell: o => <span className="mono staff-muted">{fmt.date(o.createdAt, 'short')}</span>, hideOnMobile: true },
  ];
  return (
    <>
      <PageHead title={open ? t('admin.quotes.openTitle') : t('admin.nav.quotes')} lede={t('admin.quotes.lede')}
        crumbs={open ? [{ label: t('admin.nav.quotes'), to: '/admin/quotes' }, { label: t('admin.quotes.openTitle') }] : undefined} />
      <Table columns={columns} rows={list.data?.items ?? []} rowKey={o => o.id} loading={list.isPending} caption={t('admin.nav.quotes')} empty={t('admin.quotes.empty')} onRowClick={o => navigate(`/admin/offers/${o.id}`)} />
    </>
  );
}

export function Reports() {
  const { t } = useT();
  const fmt = useFormat();
  const [params] = useSearchParams();
  useDocumentTitle(t('admin.nav.reports'));
  const q = useQuery({ queryKey: ['admin', 'reports'], queryFn: () => api('adminReports') });
  const focus = params.get('show');
  useEffect(() => {
    if (q.data && focus) document.getElementById(`report-${focus}`)?.scrollIntoView({ block: 'start' });
  }, [q.data, focus]);
  if (q.isPending) return <Skeleton lines={8} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageHead title={t('admin.nav.reports')} lede={t('admin.reports.lede')} />
      <StatGrid>
        <StatTile label={t('admin.reports.sent')} value={d.conversion.sent} />
        <StatTile label={t('admin.reports.accepted')} value={d.conversion.accepted} />
        <StatTile label={t('admin.reports.conversion')} value={d.conversion.percent ?? 0} format={n => (d.conversion.percent === null ? '—' : `${n} %`)} />
        <StatTile label={t('admin.reports.opens7')} value={d.linkActivity.opensLast7Days} />
      </StatGrid>
      <Panel title={t('admin.reports.byStatus')}>
        <HBarList label={t('admin.reports.byStatus')} items={d.quotesByStatus.map(s => ({ key: s.status, label: t(`admin.contacts.status.${s.status}` as TKey), value: s.count }))} />
      </Panel>
      <Panel title={t('admin.reports.topModels')}>
        {d.topModels.length === 0 ? <p className="staff-muted">{t('admin.quotes.empty')}</p> : (
          <HBarList label={t('admin.reports.topModels')} items={d.topModels.map(m => ({ key: m.name, label: m.name, value: m.quotes }))} />
        )}
      </Panel>
      <Panel title={t('admin.reports.links')}>
        <StatGrid>
          <StatTile label={t('admin.reports.linksShared')} value={d.linkActivity.linksShared} />
          <StatTile label={t('admin.reports.linksOpened')} value={d.linkActivity.linksOpened} />
          <StatTile label={t('admin.reports.insideViews')} value={d.linkActivity.insideViews} />
        </StatGrid>
      </Panel>
      <div id="report-expiring">
        <Panel title={t('admin.reports.expiring')}>
          {d.expiring.length === 0 ? <p className="staff-muted">{t('admin.reports.expiringNone')}</p> : (
            <ul className="staff-list">
              {d.expiring.map(e => (
                <li key={e.offerId}>
                  <Link to={`/admin/offers/${e.offerId}`} className="row-link">
                    <span className="staff-strong">{e.label} · {e.contactName}</span>
                    <span className="staff-sub">
                      {t('admin.reports.expiresOn', { date: fmt.date(e.expiresAt, 'short') })} · {e.opened ? t('admin.reports.opened') : t('admin.reports.notOpened')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
