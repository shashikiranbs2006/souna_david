import { useParams, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Clock, Copy, Download, Send } from 'lucide-react';
import { errorText } from '../../i18n/errorText.ts';
import { useSubmitRequest } from '../configurator/useSubmitRequest.ts';
import { api, isApiError } from '../../api/client.ts';
import { useSession, useTenantData } from '../../api/queries.ts';
import { isSingleShop } from '../../host.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Button, ButtonLink } from '../../design/components/Button.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { ViewerSlot } from '../../three/ViewerSlot.tsx';
import { ArButton } from '../../three/ArButton.tsx';
import { ArRoomButton } from '../../three/ar/ArRoomButton.tsx';
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

export default function Shared() {
  const { token = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const tenant = useTenantData();
  const session = useSession().data;
  const navigate = useNavigate();
  const shared = useQuery({ queryKey: ['shared', token], queryFn: () => api('shared', { params: { token } }), retry: false });
  useDocumentTitle(shared.data?.configuration.name ?? t('shared.eyebrow'));
  const onViewChange = useVisitActivity(token, isSingleShop() && !session?.kind?.startsWith('staff'));
  // A claimed copy is locked at a fresh price: offer the request straight away,
  // or a clone for customers who want to change options first.
  const claim = useMutation({
    mutationFn: () => api('claimShared', { params: { token } }),
    onSuccess: () => toast(t('shared.claimed')),
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });
  const claimedId = claim.data?.configurationId;
  const submit = useSubmitRequest();
  const clone = useMutation({
    mutationFn: (id: string) => api('clone', { params: { id } }),
    onSuccess: c => navigate(`/saunas/${c.sauna.slug}/configure?id=${c.id}`),
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });

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
  const viewerOptions = viewerOptionsOf(d.sauna, d.configuration.selections);
  const chosen = d.sauna.groups.flatMap(g => g.options.filter(o => d.configuration.selections.includes(o.id)).map(o => ({ g: g.name, o })));
  const signedIn = session?.kind === 'customer';
  // David's edition: customers only look. No claim, clone or login; they contact the shop.
  const viewOnly = isSingleShop();
  const b = tenant.branding;
  return (
    <div className="page container">
      <p className="eyebrow">{t('shared.eyebrow')}</p>
      <div className="detail">
        <div className="detail__stage">
          <ViewerSlot name={d.sauna.name} specs={specs} options={viewerOptions}lowUrl={d.sauna.assets.lowGlbUrl} highUrl={d.sauna.assets.highGlbUrl} allowHigh thumbnailUrl={d.sauna.assets.thumbnailUrl} shareToken={token} views={viewOnly} onViewChange={onViewChange} watermark={viewOnly} />
          {specs.source === 'kit' ? (
            // The exact configured sauna, exported from the same kit scene as the 3D view.
            <div className="detail__ar">
              <ArRoomButton shareToken={token} name={d.configuration.name} specs={specs} options={viewerOptions} thumbnailUrl={d.sauna.assets.thumbnailUrl} />
            </div>
          ) : (
            d.sauna.assets.hasAr && (
              <div className="detail__ar">
                <ArButton saunaModelId={d.sauna.id} name={d.sauna.name} enabled shareToken={token} />
              </div>
            )
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
              {viewOnly ? (
                <>
                  <p className="pricecard__hint">{t('shared.viewOnlyHint', { name: b.displayName })}</p>
                  <ButtonLink to="/contact" size="lg" block>
                    {t('shared.contact', { name: b.displayName })}
                  </ButtonLink>
                  {b.supportPhone && <a className="btn btn--ghost btn--md btn--block" href={`tel:${b.supportPhone.replace(/[^+\d]/g, '')}`}>{b.supportPhone}</a>}
                </>
              ) : claimedId ? (
                <div className="pricecard__claimed" role="status">
                  <p className="pricecard__claimed-title">{t('shared.claimedTitle')}</p>
                  <p className="pricecard__hint">{t('shared.claimedBody')}</p>
                  <Button icon={Send} size="lg" block onClick={() => submit.mutate({ id: claimedId })} loading={submit.isPending}>
                    {t('shared.requestQuote')}
                  </Button>
                  <Button variant="ghost" icon={Copy} block onClick={() => clone.mutate(claimedId)} loading={clone.isPending}>
                    {t('configure.clone')}
                  </Button>
                  <ButtonLink to={`/account/configurations/${claimedId}`} variant="link" block>
                    {t('shared.viewSaved')}
                  </ButtonLink>
                </div>
              ) : signedIn ? (
                <Button icon={Download} size="lg" block onClick={() => claim.mutate()} loading={claim.isPending}>
                  {t('shared.claim')}
                </Button>
              ) : (
                <>
                  <ButtonLink to={`/account/login?next=${encodeURIComponent(`/s/${token}`)}`} size="lg" block>
                    {t('nav.login')}
                  </ButtonLink>
                  <p className="pricecard__hint">{t('shared.claimHint')}</p>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
