import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Table, type Column } from '../../design/components/Table.tsx';
import { Badge } from '../../design/components/Badge.tsx';
import { Button } from '../../design/components/Button.tsx';
import { Input, Textarea } from '../../design/components/Field.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { useAdminMutation } from './helpers.ts';

type InvoiceSummary = ResponseOf<'adminInvoices'>['items'][number];
type Invoice = ResponseOf<'adminInvoice'>;

const STATUSES: Invoice['status'][] = ['ISSUED', 'PAID', 'CANCELLED'];

function StatusBadge({ i }: { i: InvoiceSummary }) {
  const { t } = useT();
  return (
    <Badge tone={i.status === 'PAID' ? 'outline' : 'muted'}>
      {t(`admin.invoices.status.${i.status}` as TKey)}{i.overdue ? ` · ${t('admin.invoices.overdue')}` : ''}
    </Badge>
  );
}

function InvoiceTable({ items, loading }: { items: InvoiceSummary[]; loading: boolean }) {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  const columns: Column<InvoiceSummary>[] = [
    {
      key: 'n', header: t('admin.nav.invoices'),
      cell: i => (
        <Link to={`/admin/invoices/${i.id}`} className="row-link">
          <span className="staff-strong">{i.label}</span>
          <span className="staff-sub">{i.quote.label} · {i.contact.personName}</span>
        </Link>
      ),
    },
    { key: 'a', header: t('admin.invoices.amount'), align: 'end', cell: i => <span className="mono">{fmt.money(i.amountMinor, i.currency)}</span> },
    { key: 's', header: t('staff.status'), cell: i => <StatusBadge i={i} /> },
    { key: 'd', header: t('admin.invoices.due'), align: 'end', cell: i => <span className="mono staff-muted">{i.dueOn}</span>, hideOnMobile: true },
  ];
  return <Table columns={columns} rows={items} rowKey={i => i.id} loading={loading} caption={t('admin.nav.invoices')} empty={t('admin.invoices.empty')} onRowClick={i => navigate(`/admin/invoices/${i.id}`)} />;
}

export function InvoicesList() {
  const { t } = useT();
  useDocumentTitle(t('admin.nav.invoices'));
  const list = useQuery({ queryKey: ['admin', 'invoices', {}], queryFn: () => api('adminInvoices', { query: {} }) });
  return (
    <>
      <PageHead title={t('admin.nav.invoices')} lede={t('admin.invoices.lede')} />
      <InvoiceTable items={list.data?.items ?? []} loading={list.isPending} />
    </>
  );
}

/** On an offer: the invoices already made for it, and the form to make a prepayment invoice once it is accepted. */
export function InvoicePanel({ quoteId, accepted }: { quoteId: string; accepted: boolean }) {
  const { t } = useT();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['admin', 'invoices', { quoteId }], queryFn: () => api('adminInvoices', { query: { quoteId } }) });
  const [percent, setPercent] = useState('30');
  const [days, setDays] = useState('14');
  const [details, setDetails] = useState('');
  const create = useAdminMutation(
    () => api('adminCreateInvoice', { body: {
      quoteId, percent: Math.min(100, Math.max(1, Number(percent) || 30)), dueInDays: Math.min(90, Math.max(0, Number(days) || 0)),
      paymentDetails: details.trim() || null,
    } }),
    { success: 'admin.invoices.created', invalidate: [['admin', 'invoices']], onSuccess: i => navigate(`/admin/invoices/${i.id}`) },
  );
  return (
    <Panel title={t('admin.nav.invoices')} lede={accepted ? undefined : t('admin.invoices.needsAccepted')}>
      {(list.data?.items.length ?? 0) > 0 && <InvoiceTable items={list.data!.items} loading={false} />}
      {accepted && (
        <form className="staff-form" onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(undefined); }}>
          <Input label={t('admin.invoices.percent')} type="number" min={1} max={100} value={percent} onChange={e => setPercent(e.target.value)} />
          <Input label={t('admin.invoices.dueInDays')} type="number" min={0} max={90} value={days} onChange={e => setDays(e.target.value)} />
          <Textarea label={t('admin.invoices.paymentDetails')} value={details} onChange={e => setDetails(e.target.value)} maxLength={2000} rows={3} />
          <div className="staff-form__actions">
            <Button type="submit" loading={create.isPending}>{t('admin.invoices.create')}</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

export function InvoiceDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['admin', 'invoice', id], queryFn: () => api('adminInvoice', { params: { id } }) });
  const status = useAdminMutation((s: Invoice['status']) => api('adminInvoiceStatus', { params: { id }, body: { status: s } }), {
    success: 'admin.contacts.saved', invalidate: [['admin', 'invoice', id], ['admin', 'invoices']],
  });
  useDocumentTitle(q.data?.label ?? t('admin.nav.invoices'));
  if (q.isPending) return <Skeleton lines={8} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const i = q.data;
  return (
    <>
      <PageHead
        crumbs={[{ label: t('admin.nav.invoices'), to: '/admin/invoices' }, { label: i.label }]}
        title={i.label}
        lede={<><Link to={`/admin/offers/${i.quote.id}`}>{i.quote.label}</Link> · <Link to={`/admin/contacts/${i.contact.id}`}>{i.contact.personName}</Link></>}
        meta={<StatusBadge i={i} />}
        actions={<a className="btn btn--ghost btn--sm" href={`/api/admin/invoices/${i.id}/pdf`} download>{t('admin.contacts.downloadPdf')}</a>}
      />
      <Panel>
        <dl className="staff-dl">
          <dt>{t('admin.invoices.quoteTotal')}</dt>
          <dd className="mono">{fmt.money(i.quoteTotalMinor, i.currency)}</dd>
          <dt>{t('admin.invoices.percent')}</dt>
          <dd className="mono">{i.percent} %</dd>
          <dt>{t('admin.invoices.amount')}</dt>
          <dd className="mono staff-strong">{fmt.money(i.amountMinor, i.currency)}</dd>
          <dt>{t('admin.invoices.issued')}</dt>
          <dd className="mono">{i.issuedOn}</dd>
          <dt>{t('admin.invoices.due')}</dt>
          <dd className="mono">{i.dueOn}</dd>
          {i.paidAt && (
            <>
              <dt>{t('admin.invoices.paidOn')}</dt>
              <dd className="mono">{fmt.date(i.paidAt, 'short')}</dd>
            </>
          )}
        </dl>
        {i.paymentDetails && <p className="staff-muted">{i.paymentDetails}</p>}
        <p className="staff-muted">{t('admin.contacts.markAs')}</p>
        <div className="staff-form__actions">
          {STATUSES.filter(s => s !== i.status && !(i.status === 'CANCELLED')).map(s => (
            <Button key={s} size="sm" variant="ghost" loading={status.isPending && status.variables === s} onClick={() => status.mutate(s)}>
              {t(`admin.invoices.status.${s}` as TKey)}
            </Button>
          ))}
        </div>
      </Panel>
    </>
  );
}
