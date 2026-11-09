import { useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Clock } from 'lucide-react';
import { api, isApiError } from '../../api/client.ts';
import { useSession, useTenantData } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Button, ButtonLink } from '../../design/components/Button.tsx';
import { Input, Textarea } from '../../design/components/Field.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { ViewerSlot } from '../../three/ViewerSlot.tsx';
import { ArButton } from '../../three/ArButton.tsx';
import { specsOf } from '../components/specs.ts';
import { viewerOptionsOf } from '../components/sauna-helpers.ts';
import './SaunaDetail.css';

/**
 * David's edition: tell the shop what the visitor did on the page (inside view, seconds the tab
 * was visible). Best effort every 15 s while visible, so closing the tab loses at most a few seconds.
 */
function useVisitActivity(token: string, enabled: boolean) {
  const visit = useRef({ id: '', inside: false, seconds: 0 });
  const send = useRef(() => {});
  send.current = () => {
    const v = visit.current;
    if (!enabled || !v.id) return;
    void api('sharedActivity', { params: { token }, body: { visitId: v.id, insideView: v.inside, seconds: Math.min(3600, Math.round(v.seconds)) } }).catch(() => {});
  };
  useEffect(() => {
    if (!enabled) return;
    visit.current = { id: crypto.randomUUID(), inside: false, seconds: 0 };
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || visit.current.seconds >= 3600) return;
      visit.current.seconds += 5;
      if (visit.current.seconds % 15 === 0) send.current();
    }, 5000);
    const onHide = () => document.visibilityState === 'hidden' && send.current();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onHide);
      send.current();
    };
  }, [token, enabled]);
  return (view: 'exterior' | 'interior') => {
    if (view !== 'interior' || visit.current.inside) return;
    visit.current.inside = true;
    send.current();
  };
}

/** A question to the shop from the customer link: it arrives by e-mail with the customer as Reply-To. */
function EnquiryForm({ token }: { token: string }) {
  const { t } = useT();
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const send = useMutation({
    mutationFn: () => api('sharedEnquiry', { params: { token }, body: { name: form.name.trim(), email: form.email.trim(), message: form.message.trim(), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) } }),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));
  if (send.isSuccess)
    return (
      <p className="pricecard__hint" role="status">
        {t('shared.enquirySent')}
      </p>
    );
  return (
    <form
      className="enquiry"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <h2 className="enquiry__title">{t('shared.enquiryTitle')}</h2>
      <p className="pricecard__hint">{t('shared.enquiryIntro')}</p>
      <Input label={t('shared.enquiryName')} value={form.name} onChange={set('name')} autoComplete="name" required maxLength={120} />
      <Input label={t('shared.enquiryEmail')} type="email" value={form.email} onChange={set('email')} autoComplete="email" required maxLength={254} />
      <Input label={t('shared.enquiryPhone')} type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" maxLength={40} />
      <Textarea label={t('shared.enquiryMessage')} value={form.message} onChange={set('message')} required maxLength={4000} rows={4} />
      {send.isError && <p className="field__error" role="alert">{t('shared.enquiryError')}</p>}
      <Button type="submit" size="lg" block loading={send.isPending}>
        {t('shared.enquirySend')}
      </Button>
    </form>
  );
}

export default function Shared() {
  const { token = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const tenant = useTenantData();
  const session = useSession().data;
  const shared = useQuery({ queryKey: ['shared', token], queryFn: () => api('shared', { params: { token } }), retry: false });
  useDocumentTitle(shared.data?.configuration.name ?? t('shared.eyebrow'));
  const onViewChange = useVisitActivity(token, session?.kind !== 'staff');
  if (shared.isPending)
    return (
      <div className="page container detail" aria-hidden="true">
        <Skeleton height="auto" style={{ aspectRatio: '4 / 3.2' }} />
        <Skeleton lines={6} />
      </div>
    );
  if (shared.error) {
    if (isApiError(shared.error, 'SHARE_LINK_EXPIRED') || isApiError(shared.error, 'SHARE_LINK_REVOKED') || isApiError(shared.error, 'NOT_FOUND') || isApiError(shared.error, 'GONE')) {
      return (
        <div className="page container">
          <EmptyState
            icon={Clock}
            title={t('shared.expiredTitle')}
            body={t('shared.expiredBody', { name: tenant.branding.displayName })}
            action={<ButtonLink to="/contact">{t('shared.contact', { name: tenant.branding.displayName })}</ButtonLink>}
          />
        </div>
      );
    }
    return <ErrorPage error={shared.error} />;
  }

  const d = shared.data;
  const specs = specsOf(d.sauna);
  const chosen = d.sauna.groups.flatMap(g => g.options.filter(o => d.configuration.selections.includes(o.id)).map(o => ({ g: g.name, o })));
  // Customers only look: no account, no changes; they contact the shop.
  const b = tenant.branding;
  return (
    <div className="page container">
      <p className="eyebrow">{t('shared.eyebrow')}</p>
      <div className="detail">
        <div className="detail__stage">
          <ViewerSlot name={d.sauna.name} specs={specs} options={viewerOptionsOf(d.sauna, d.configuration.selections)} lowUrl={d.sauna.assets.lowGlbUrl} highUrl={d.sauna.assets.highGlbUrl} allowHigh thumbnailUrl={d.sauna.assets.thumbnailUrl} shareToken={token} views onViewChange={onViewChange} watermark />
          {d.sauna.assets.hasAr && (
            <div className="detail__ar">
              <ArButton saunaModelId={d.sauna.id} name={d.sauna.name} enabled shareToken={token} />
            </div>
          )}
        </div>
        <aside className="detail__aside">
          <div className="detail__sticky">
            <ScrambleText as="h1" className="detail__title" text={d.configuration.name} />
            <p className="detail__desc">{d.sauna.name}</p>
            <dl className="kv">
              {chosen.map(c => (
                <div key={c.o.id} style={{ display: 'contents' }}>
                  <dt>{c.g}</dt>
                  <dd>{c.o.name}</dd>
                </div>
              ))}
            </dl>
            <div className="pricecard">
              <Price minor={d.snapshot.finalPriceMinor} currency={d.snapshot.currency} listMinor={d.snapshot.discountMinor > 0 ? d.snapshot.subtotalMinor : null} size="lg" />
              <p className="pricecard__vat">{t('shared.priceAsOf', { date: fmt.date(d.snapshot.computedAt) })} · {t('shared.validUntil', { date: fmt.date(d.snapshot.priceValidUntil) })}</p>
              <p className="pricecard__vat">{t('shared.expires', { date: fmt.date(d.expiresAt) })}</p>
              <p className="pricecard__hint">{t('shared.viewOnlyHint', { name: b.displayName })}</p>
              <EnquiryForm token={token} />
              {b.supportPhone && <a className="btn btn--ghost btn--md btn--block" href={`tel:${b.supportPhone.replace(/[^+\d]/g, '')}`}>{b.supportPhone}</a>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
