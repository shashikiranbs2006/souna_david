import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Mail, Plus, Trash2 } from 'lucide-react';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { CustomerLinkMaker } from './CustomerLink.tsx';
import { LOCALE_NAMES, OFFERED_LOCALES, useT, type Locale, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Table, type Column } from '../../design/components/Table.tsx';
import { Badge } from '../../design/components/Badge.tsx';
import { Button, ButtonLink } from '../../design/components/Button.tsx';
import { Input, Select, Textarea } from '../../design/components/Field.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { InvoicePanel } from './Invoices.tsx';
import { minorToInput, parseMoney, useAdminMutation, useDebounced } from './helpers.ts';

type Contact = ResponseOf<'adminContacts'>['items'][number];
type OfferSummary = ResponseOf<'adminOffers'>['items'][number];
type Offer = ResponseOf<'adminOffer'>;
type Status = Offer['status'];

const STATUSES: Status[] = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED'];
const orNull = (s: string) => (s.trim() ? s.trim() : null);

function ContactForm({ initial, submitLabel, onSubmit, busy }: {
  initial?: Contact; submitLabel: string; busy: boolean;
  onSubmit: (v: { personName: string; organisation: string | null; email: string | null; mobile: string | null; notes: string | null }) => void;
}) {
  const { t } = useT();
  const [personName, setPersonName] = useState(initial?.personName ?? '');
  const [organisation, setOrganisation] = useState(initial?.organisation ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [mobile, setMobile] = useState(initial?.mobile ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ personName: personName.trim(), organisation: orNull(organisation), email: orNull(email), mobile: orNull(mobile), notes: orNull(notes) });
  };
  return (
    <form className="staff-form" onSubmit={submit}>
      <Input label={t('admin.contacts.personName')} value={personName} onChange={e => setPersonName(e.target.value)} maxLength={200} required />
      <Input label={t('admin.contacts.organisation')} value={organisation} onChange={e => setOrganisation(e.target.value)} maxLength={200} />
      <Input label={t('admin.contacts.email')} type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} />
      <Input label={t('admin.contacts.mobile')} type="tel" value={mobile} onChange={e => setMobile(e.target.value)} maxLength={40} />
      <Textarea label={t('admin.contacts.notes')} value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={3} />
      <div className="staff-form__actions">
        <Button type="submit" loading={busy} disabled={!personName.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function ContactsList() {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  useDocumentTitle(t('admin.nav.contacts'));
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [adding, setAdding] = useState(false);
  const q = useDebounced(search.trim());
  const list = useQuery({ queryKey: ['admin', 'contacts', { q }], queryFn: () => api('adminContacts', { query: q ? { q } : {} }) });
  const create = useAdminMutation((body: Parameters<typeof api<'adminCreateContact'>>[1] extends { body: infer B } ? B : never) => api('adminCreateContact', { body }), {
    success: 'admin.contacts.created', invalidate: [['admin', 'contacts']], onSuccess: c => navigate(`/admin/contacts/${c.id}`),
  });
  const columns: Column<Contact>[] = [
    {
      key: 'name', header: t('staff.name'), sortValue: c => c.personName,
      cell: c => (
        <Link to={`/admin/contacts/${c.id}`} className="row-link">
          <span className="staff-strong">{c.personName}</span>
          <span className="staff-sub">{[c.organisation, c.email].filter(Boolean).join(' · ')}</span>
        </Link>
      ),
    },
    { key: 'mobile', header: t('admin.contacts.mobile'), cell: c => <span className="mono">{c.mobile ?? '—'}</span>, hideOnMobile: true },
    { key: 'quotes', header: t('admin.contacts.quotes'), align: 'end', cell: c => <span className="mono">{c.quotes}</span>, sortValue: c => c.quotes },
    { key: 'since', header: t('admin.contacts.since'), align: 'end', cell: c => <span className="mono staff-muted">{fmt.date(c.createdAt, 'short')}</span>, sortValue: c => c.createdAt, hideOnMobile: true },
  ];
  return (
    <>
      <PageHead title={t('admin.nav.contacts')} lede={t('admin.contacts.lede')} actions={<Button size="sm" icon={Plus} onClick={() => setAdding(a => !a)}>{t('admin.contacts.add')}</Button>} />
      {adding && (
        <Panel>
          <ContactForm submitLabel={t('admin.contacts.add')} busy={create.isPending} onSubmit={v => create.mutate(v)} />
        </Panel>
      )}
      <div className="staff-toolbar" role="search">
        <Input label={t('staff.search')} type="search" placeholder={t('admin.contacts.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <Table columns={columns} rows={list.data?.items ?? []} rowKey={c => c.id} loading={list.isPending} caption={t('admin.nav.contacts')} empty={t('admin.contacts.empty')} onRowClick={c => navigate(`/admin/contacts/${c.id}`)} />
    </>
  );
}

export function ContactDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  const contact = useQuery({ queryKey: ['admin', 'contact', id], queryFn: () => api('adminContact', { params: { id } }) });
  const offers = useQuery({ queryKey: ['admin', 'offers', { contactId: id }], queryFn: () => api('adminOffers', { query: { contactId: id } }) });
  const update = useAdminMutation((body: Parameters<typeof ContactForm>[0] extends { onSubmit: (v: infer V) => void } ? V : never) => api('adminUpdateContact', { params: { id }, body }), {
    success: 'admin.contacts.saved', invalidate: [['admin', 'contact', id], ['admin', 'contacts']],
  });
  useDocumentTitle(contact.data?.personName ?? t('admin.nav.contacts'));
  if (contact.isPending) return <Skeleton lines={8} />;
  if (contact.error) return <ErrorPage error={contact.error} onRetry={() => void contact.refetch()} />;
  const c = contact.data;
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
    { key: 'v', header: t('admin.contacts.version'), align: 'end', cell: o => <span className="mono">v{o.version}</span> },
    { key: 's', header: t('staff.status'), cell: o => <Badge tone={o.status === 'ACCEPTED' ? 'outline' : 'muted'}>{t(`admin.contacts.status.${o.status}` as TKey)}</Badge> },
    { key: 'd', header: t('admin.contacts.since'), align: 'end', cell: o => <span className="mono staff-muted">{fmt.date(o.createdAt, 'short')}</span>, hideOnMobile: true },
  ];
  return (
    <>
      <PageHead crumbs={[{ label: t('admin.nav.contacts'), to: '/admin/contacts' }, { label: c.personName }]} title={c.personName} lede={c.organisation ?? undefined} />
      <Panel title={t('admin.contacts.contact')}>
        <ContactForm key={c.updatedAt} initial={c} submitLabel={t('admin.contacts.saveChanges')} busy={update.isPending} onSubmit={v => update.mutate(v)} />
      </Panel>
      <Panel title={t('admin.contacts.quotes')} action={<ButtonLink to={`/admin/contacts/${id}/quote`} icon={Plus} size="sm">{t('admin.contacts.newQuote')}</ButtonLink>}>
        <Table columns={columns} rows={offers.data?.items ?? []} rowKey={o => o.id} loading={offers.isPending} caption={t('admin.contacts.quotes')} empty={t('admin.contacts.noQuotes')} onRowClick={o => navigate(`/admin/offers/${o.id}`)} />
      </Panel>
    </>
  );
}

interface LineDraft { label: string; amount: string }

function LinesEditor({ lines, onChange }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void }) {
  const { t } = useT();
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <fieldset className="staff-lines">
      <legend>{t('admin.contacts.extraLines')}</legend>
      {lines.map((l, i) => (
        <div key={i} className="staff-lines__row">
          <Input label={t('admin.contacts.lineLabel')} value={l.label} onChange={e => set(i, { label: e.target.value })} maxLength={200} />
          <Input label={t('admin.contacts.lineAmount')} inputMode="decimal" value={l.amount} onChange={e => set(i, { amount: e.target.value })} />
          <Button type="button" variant="quiet" size="sm" icon={Trash2} aria-label="–" onClick={() => onChange(lines.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button type="button" variant="quiet" size="sm" icon={Plus} onClick={() => onChange([...lines, { label: '', amount: '' }])}>
        {t('admin.contacts.addLine')}
      </Button>
    </fieldset>
  );
}

const toLines = (drafts: LineDraft[]) =>
  drafts.filter(l => l.label.trim()).map(l => ({ label: l.label.trim(), amountMinor: (l.amount.trim().startsWith('-') ? -1 : 1) * (parseMoney(l.amount.replace('-', '')) ?? 0) }));
const fromLines = (lines: Offer['lines']): LineDraft[] => lines.map(l => ({ label: l.label, amount: (l.amountMinor < 0 ? '-' : '') + minorToInput(Math.abs(l.amountMinor)) }));

export function NewOffer() {
  const { id = '' } = useParams();
  const { t } = useT();
  const navigate = useNavigate();
  useDocumentTitle(t('admin.contacts.newQuote'));
  const contact = useQuery({ queryKey: ['admin', 'contact', id], queryFn: () => api('adminContact', { params: { id } }) });
  const configs = useQuery({ queryKey: ['admin', 'configurations', 'all'], queryFn: () => api('adminConfigurations', { query: { limit: 100 } }) });
  const [configId, setConfigId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [comment, setComment] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const items = configs.data?.items ?? [];
  const chosen = configId || items[0]?.id || '';
  const create = useAdminMutation(
    () => api('adminCreateOffer', { body: { contactId: id, configurationId: chosen, quantity: Math.max(1, Number(quantity) || 1), comment: orNull(comment), lines: toLines(lines) } }),
    { success: 'admin.contacts.quoteCreated', invalidate: [['admin', 'offers'], ['admin', 'contacts']], onSuccess: o => navigate(`/admin/offers/${o.id}`, { replace: true }) },
  );
  if (contact.isPending || configs.isPending) return <Skeleton lines={6} />;
  if (contact.error) return <ErrorPage error={contact.error} onRetry={() => void contact.refetch()} />;
  return (
    <>
      <PageHead crumbs={[{ label: t('admin.nav.contacts'), to: '/admin/contacts' }, { label: contact.data.personName, to: `/admin/contacts/${id}` }, { label: t('admin.contacts.newQuote') }]} title={t('admin.contacts.newQuote')} />
      {items.length === 0 ? (
        <Panel>
          <p>{t('admin.contacts.noConfigurations')}</p>
          <ButtonLink to="/admin/configurations/new">{t('admin.configurations.new')}</ButtonLink>
        </Panel>
      ) : (
        <form className="staff-form" onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(undefined); }}>
          <Select label={t('admin.contacts.configuration')} value={chosen} onChange={e => setConfigId(e.target.value)} options={items.map(c => ({ value: c.id, label: `${c.name} · ${c.sauna.name}` }))} required />
          <Input label={t('admin.contacts.quantity')} type="number" min={1} max={99} value={quantity} onChange={e => setQuantity(e.target.value)} />
          <LinesEditor lines={lines} onChange={setLines} />
          <Textarea label={t('admin.contacts.comment')} value={comment} onChange={e => setComment(e.target.value)} maxLength={4000} rows={3} />
          <div className="staff-form__actions">
            <Button type="submit" loading={create.isPending}>{t('admin.contacts.newQuote')}</Button>
            <ButtonLink to={`/admin/contacts/${id}`} variant="quiet">{t('staff.cancel')}</ButtonLink>
          </div>
        </form>
      )}
    </>
  );
}

const LEVEL_TONE = { NONE: 'muted', LOW: 'muted', MEDIUM: 'soft', HIGH: 'outline' } as const;

/** What the customer did with the share link, and the explainable score (docs/david-fork-plan.md section 6). */
function TrackingPanel({ offerId, configurationId }: { offerId: string; configurationId: string }) {
  const { t } = useT();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['admin', 'offer', offerId, 'tracking'], queryFn: () => api('adminOfferTracking', { params: { id: offerId } }), refetchInterval: 60_000 });
  // A link made here stays on screen (it is shown only once) until David leaves the page.
  const [made, setMade] = useState(false);
  // Minimisable; the choice is remembered in this browser (storage can be unavailable, then it starts open).
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('admin.tracking.open') !== '0'; } catch { return true; }
  });
  const toggle = () => setOpen(o => {
    try { localStorage.setItem('admin.tracking.open', o ? '0' : '1'); } catch { /* ignore */ }
    return !o;
  });
  if (q.isPending) return <Skeleton lines={3} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d.link || made)
    return (
      <Panel title={t('admin.contacts.tracking.title')}>
        <p className="staff-muted">{t('admin.contacts.tracking.noLink')}</p>
        <CustomerLinkMaker configurationId={() => Promise.resolve(configurationId)} onCreated={() => setMade(true)} />
      </Panel>
    );
  const k = (key: string) => t(`admin.contacts.tracking.${key}` as TKey);
  const visit = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const recentColumns: Column<(typeof d.recent)[number]>[] = [
    { key: 'when', header: k('colWhen'), label: k('colWhen'), sortValue: v => v.viewedAt, cell: v => <span className="mono">{fmt.date(v.viewedAt, 'short')}</span> },
    { key: 'device', header: k('colDevice'), label: k('colDevice'), cell: v => t(`admin.contacts.tracking.device.${v.device}` as TKey) },
    { key: 'network', header: k('colNetwork'), label: k('colNetwork'), hideOnMobile: true, cell: v => <span className="mono">{v.network ?? '-'}</span> },
  ];
  return (
    <Panel
      title={t('admin.contacts.tracking.title')}
      lede={t('admin.contacts.tracking.hint')}
      action={
        <Button variant="quiet" size="sm" icon={open ? ChevronUp : ChevronDown} aria-expanded={open} onClick={toggle}>
          {open ? k('hide') : k('show')}
        </Button>
      }
    >
      <div className="tracking__stats">
        <div className="tracking__stat">
          <span className="tracking__label">{k('likelihood')}</span>
          <span><Badge tone={LEVEL_TONE[d.score.level]}>{t(`admin.contacts.tracking.level.${d.score.level}` as TKey)}</Badge> <span className="mono">{d.score.points}/100</span></span>
        </div>
        <div className="tracking__stat"><span className="tracking__label">{k('opens')}</span><span className="tracking__value mono">{d.opens}</span></div>
        <div className="tracking__stat"><span className="tracking__label">{k('visitors')}</span><span className="tracking__value mono">{d.visitors}</span></div>
        <div className="tracking__stat"><span className="tracking__label">{k('lastOpened')}</span><span className="mono">{d.lastOpenedAt ? fmt.date(d.lastOpenedAt, 'short') : k('neverOpened')}</span></div>
      </div>
      {open && (
        <div className="tracking__body">
          <div className="tracking__stats tracking__stats--sub">
            <div className="tracking__stat"><span className="tracking__label">{k('insideViewOpened')}</span><span>{d.insideViewOpened ? k('yes') : k('no')}</span></div>
            <div className="tracking__stat"><span className="tracking__label">{k('longestVisit')}</span><span className="mono">{visit(d.longestVisitSeconds)}</span></div>
          </div>
          {d.score.reasons.length > 0 && (
            <ul className="tracking__reasons">
              {d.score.reasons.map(r => (
                <li key={r.code}>
                  <span className="mono">{r.points > 0 ? '+' : ''}{r.points}</span> {t(`admin.contacts.tracking.reason.${r.code}` as TKey)}
                </li>
              ))}
            </ul>
          )}
          <h3 className="tracking__heading">{k('recent')}</h3>
          <Table
            columns={recentColumns}
            rows={d.recent}
            rowKey={v => `${v.viewedAt}-${v.network ?? ''}`}
            caption={k('recent')}
            empty={k('neverOpened')}
            initialSort={{ key: 'when', dir: 'desc' }}
          />
          <p className="staff-muted tracking__note">{k('staffNote')}</p>
        </div>
      )}
    </Panel>
  );
}

/** Sends the quote to the customer by e-mail: PDF attached, link to the sauna in 3D (view only). */
function SendOffer({ offerId, contactId, status }: { offerId: string; contactId: string; status: Status }) {
  const { t, locale } = useT();
  const contact = useQuery({ queryKey: ['admin', 'contact', contactId], queryFn: () => api('adminContact', { params: { id: contactId } }) });
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [lang, setLang] = useState<Locale>(locale);
  const email = contact.data?.email ?? null;
  const send = useAdminMutation(
    () => api('adminSendOffer', { params: { id: offerId }, body: { ...(message.trim() ? { message: message.trim() } : {}), locale: lang } }),
    { success: () => t('admin.contacts.quoteSentToast', { email: email ?? '' }), invalidate: [['admin', 'offer', offerId], ['admin', 'offers']], onSuccess: () => { setOpen(false); setMessage(''); } },
  );
  return (
    <>
      <div className="staff-form__actions">
        <Button icon={Mail} variant={status === 'DRAFT' ? 'primary' : 'ghost'} onClick={() => setOpen(true)} disabled={!email}>
          {status === 'DRAFT' ? t('admin.contacts.sendQuote') : t('admin.contacts.resend')}
        </Button>
        {contact.data && !email && <span className="staff-muted">{t('admin.contacts.noEmail')}</span>}
        {status === 'SENT' && <Badge tone="soft">{t('admin.contacts.status.SENT')}</Badge>}
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={status === 'DRAFT' ? t('admin.contacts.sendQuoteTitle') : t('admin.contacts.resendTitle')}
        description={status === 'DRAFT' ? t('admin.contacts.sendQuoteBody', { email: email ?? '' }) : t('admin.contacts.resendBody', { email: email ?? '' })}
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button icon={Mail} onClick={() => send.mutate(undefined)} loading={send.isPending}>{t('admin.contacts.sendQuoteConfirm')}</Button>
          </>
        }
      >
        <div className="stack">
          <Select label={t('nav.language')} value={lang} onChange={e => setLang(e.target.value as Locale)} options={OFFERED_LOCALES.map(l => ({ value: l, label: LOCALE_NAMES[l] }))} />
          <Textarea label={t('admin.contacts.sendQuoteMessage')} value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={4} />
        </div>
      </Dialog>
    </>
  );
}

export function OfferDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['admin', 'offer', id], queryFn: () => api('adminOffer', { params: { id } }) });
  const [quantity, setQuantity] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const status = useAdminMutation((s: Status) => api('adminOfferStatus', { params: { id }, body: { status: s } }), { success: 'admin.contacts.saved', invalidate: [['admin', 'offer', id], ['admin', 'offers']] });
  const version = useAdminMutation(
    () => api('adminOfferVersion', { params: { id }, body: {
      ...(quantity !== null ? { quantity: Math.max(1, Number(quantity) || 1) } : {}),
      ...(comment !== null ? { comment: orNull(comment) } : {}),
      ...(lines !== null ? { lines: toLines(lines) } : {}),
    } }),
    { success: 'admin.contacts.versionSaved', invalidate: [['admin', 'offers']], onSuccess: o => navigate(`/admin/offers/${o.id}`) },
  );
  useDocumentTitle(q.data ? `${q.data.label} v${q.data.version}` : t('admin.contacts.quotes'));
  if (q.isPending) return <Skeleton lines={8} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;
  const edited = quantity !== null || comment !== null || lines !== null;
  return (
    <>
      <PageHead
        crumbs={[{ label: t('admin.nav.contacts'), to: '/admin/contacts' }, { label: o.contact.personName, to: `/admin/contacts/${o.contact.id}` }, { label: o.label }]}
        title={`${o.label} · v${o.version}`}
        lede={<>{o.sauna.name} · <Link to={`/admin/configurations/${o.configuration.id}`}>{o.configuration.name}</Link></>}
        meta={<Badge tone="muted">{t(`admin.contacts.status.${o.status}` as TKey)}</Badge>}
        actions={<a className="btn btn--ghost btn--sm" href={`/api/admin/offers/${o.id}/pdf`} download>{t('admin.contacts.downloadPdf')}</a>}
      />
      <Panel>
        <dl className="staff-dl">
          <dt>{t('admin.contacts.unitPrice')}</dt>
          <dd className="mono">{fmt.money(o.unitPriceMinor, o.currency)}</dd>
          {o.lines.map(l => (
            <div key={l.label} className="staff-dl__row">
              <dt>{l.label}</dt>
              <dd className="mono">{fmt.money(l.amountMinor, o.currency)}</dd>
            </div>
          ))}
          <dt>{t('admin.contacts.total')}</dt>
          <dd className="mono staff-strong">{fmt.money(o.totalMinor, o.currency)}</dd>
        </dl>
        {o.versions[0]?.id === o.id && <SendOffer offerId={o.id} contactId={o.contact.id} status={o.status} />}
        <p className="staff-muted">{t('admin.contacts.markAs')}</p>
        <div className="staff-form__actions">
          {(o.versions[0]?.id === o.id ? STATUSES.filter(s => s !== o.status && (o.status === 'DRAFT' || o.status === 'SENT')) : []).map(s => (
            <Button key={s} size="sm" variant="ghost" loading={status.isPending && status.variables === s} onClick={() => status.mutate(s)}>
              {t(`admin.contacts.status.${s}` as TKey)}
            </Button>
          ))}
        </div>
      </Panel>
      <InvoicePanel quoteId={o.id} accepted={o.status === 'ACCEPTED'} />
      <TrackingPanel offerId={o.id} configurationId={o.configuration.id} />
      <Panel title={t('admin.contacts.newVersion')}>
        <form className="staff-form" onSubmit={(e: FormEvent) => { e.preventDefault(); version.mutate(undefined); }}>
          <Input label={t('admin.contacts.quantity')} type="number" min={1} max={99} value={quantity ?? String(o.quantity)} onChange={e => setQuantity(e.target.value)} />
          <LinesEditor lines={lines ?? fromLines(o.lines)} onChange={setLines} />
          <Textarea label={t('admin.contacts.comment')} value={comment ?? o.comment ?? ''} onChange={e => setComment(e.target.value)} maxLength={4000} rows={3} />
          <div className="staff-form__actions">
            <Button type="submit" loading={version.isPending} disabled={!edited}>{t('admin.contacts.newVersion')}</Button>
          </div>
        </form>
      </Panel>
      {o.versions.length > 1 && (
        <Panel title={t('admin.contacts.versions')}>
          <ul>
            {o.versions.map(v => (
              <li key={v.id}>
                {v.id === o.id ? <strong>v{v.version}</strong> : <Link to={`/admin/offers/${v.id}`}>v{v.version}</Link>} · {t(`admin.contacts.status.${v.status}` as TKey)} · {fmt.date(v.createdAt, 'short')}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
