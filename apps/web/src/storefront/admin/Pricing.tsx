import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { useT } from '../../i18n/i18n.ts';
import { Button } from '../../design/components/Button.tsx';
import { Input } from '../../design/components/Field.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { minorToInput, parseMoney, parsePercentBps, useAdminMutation } from './helpers.ts';
import { OwnerOnlyNote, useCanManageShop } from './permissions.tsx';

type Sauna = ResponseOf<'adminPricing'>['items'][number];

const bpsToInput = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);

/** One sauna: base price and the largest discount, saved on its own. */
function PriceRow({ sauna, currency, canEdit }: { sauna: Sauna; currency: string; canEdit: boolean }) {
  const { t } = useT();
  const [price, setPrice] = useState(sauna.listPriceMinor === null ? '' : minorToInput(sauna.listPriceMinor));
  const [discount, setDiscount] = useState(sauna.maxDiscountBps === null ? '' : bpsToInput(sauna.maxDiscountBps));
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation(
    (v: { listPriceMinor: number; maxDiscountBps: number }) => api('adminPutPrice', { params: { id: sauna.id }, body: v }),
    { success: 'admin.pricing.saved', invalidate: [['admin', 'pricing'], ['admin', 'saunas']] },
  );

  const priceMinor = parseMoney(price);
  const bps = parsePercentBps(discount);
  const priceError = submitted && priceMinor === null ? t('admin.pricing.invalid') : undefined;
  const discountError = submitted && (bps === null || bps > 10_000) ? t('admin.pricing.invalidDiscount') : undefined;
  const changed = priceMinor !== sauna.listPriceMinor || bps !== sauna.maxDiscountBps;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (priceMinor === null || bps === null || bps > 10_000) return;
    save.mutate({ listPriceMinor: priceMinor, maxDiscountBps: bps });
  };

  return (
    <Panel title={sauna.name}>
      <form className="staff-form pricing-row" onSubmit={submit} noValidate>
        <Input
          label={`${t('admin.pricing.basePrice')} (${currency})`}
          inputMode="decimal"
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder={t('admin.pricing.notSet')}
          error={priceError}
          disabled={!canEdit}
        />
        <Input
          label={t('admin.pricing.maxDiscount')}
          inputMode="decimal"
          value={discount}
          onChange={e => setDiscount(e.target.value)}
          placeholder={t('admin.pricing.notSet')}
          error={discountError}
          disabled={!canEdit}
        />
        {canEdit && (
          <div className="staff-form__actions">
            <Button type="submit" loading={save.isPending} disabled={!changed}>
              {t('staff.save')}
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

/** Base price and largest discount of every sauna the shop offers. Owner only. */
export function PricingAdmin() {
  const { t } = useT();
  const canEdit = useCanManageShop();
  useDocumentTitle(t('admin.nav.prices'));
  const q = useQuery({ queryKey: ['admin', 'pricing'], queryFn: () => api('adminPricing') });

  return (
    <>
      <PageHead title={t('admin.nav.prices')} lede={t('admin.pricing.lede', { currency: q.data?.currency ?? '' })} />
      {!canEdit && <OwnerOnlyNote />}
      {q.isPending && <Skeleton lines={6} />}
      {q.isError && <ErrorPage error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title={t('admin.pricing.none')} />}
      {q.data?.items.map(s => (
        <PriceRow
          key={`${s.id}:${s.listPriceMinor}:${s.maxDiscountBps}`}
          sauna={s}
          currency={q.data.currency}
          canEdit={canEdit}
        />
      ))}
    </>
  );
}
