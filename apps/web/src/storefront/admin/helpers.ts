import { useEffect, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { errorText } from '../../i18n/errorText.ts';
import { toast } from '../../design/components/Toast.tsx';

/** "1’234.50", "1234,5" or "1 234" in major units → minor units (2 decimals), or null. */
export function parseMoney(input: string): number | null {
  const clean = input.replace(/[\s'’_]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export const minorToInput = (minor: number) => (minor / 100).toFixed(2);

/** "7.5" → 750 basis points, or null. */
export function parsePercentBps(input: string): number | null {
  const clean = input.replace(',', '.').replace('%', '').trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/**
 * Admin write with the house rules: toast on success, localised problem on
 * error, and invalidation of the lists it touches.
 */
export function useAdminMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>, opts: { success?: TKey | ((d: TData) => string); invalidate?: QueryKey[]; onSuccess?: (d: TData, v: TVars) => void } = {}) {
  const { t } = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d, v) => {
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(d) : t(opts.success));
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(d, v);
    },
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });
}

/** Debounced copy of a value (search fields). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
