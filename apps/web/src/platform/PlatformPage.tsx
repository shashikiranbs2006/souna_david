import { useEffect } from 'react';
import { useT } from '../i18n/i18n.ts';
import type { HostKind } from '../host.ts';
import { ScrambleText } from '../motion/ScrambleText.tsx';
import { Credit } from '../design/components/Credit.tsx';
import { Logo } from '../design/brand/Logo.tsx';
import { applyTheme } from '../design/theme.ts';
import { hideSplash } from '../app/splash.ts';
import { LanguageSwitcher } from '../storefront/layout/LanguageSwitcher.tsx';
import '../design/layout.css';
import './Platform.css';

function useBareTheme(title: string) {
  useEffect(() => {
    applyTheme(null);
    hideSplash();
    document.title = title;
  }, [title]);
}

/** Shown when an address has no shop (wrong host) or the shop is closed. */
export function UnknownHost({ reason, attempted }: { reason: 'unknown-host' | 'reserved-slug' | 'suspended'; attempted?: string | undefined }) {
  const { t } = useT();
  useBareTheme(t('platform.unknownTitle'));
  const host = attempted ?? window.location.hostname;
  return (
    <div className="pf">
      <header className="pf__head container">
        <span className="pf__logo">
          <Logo size={28} draw />
        </span>
        <LanguageSwitcher compact />
      </header>
      <main id="main" tabIndex={-1} className="main main--sheet">
        <section className="pf__hero pf__hero--unknown container">
          <ScrambleText as="p" className="eyebrow" text={t('platform.unknownEyebrow')} />
          <ScrambleText as="h1" className="pf__title" text={reason === 'suspended' ? t('platform.suspendedTitle') : t('platform.unknownTitle')} />
          <p className="lede">
            {reason === 'suspended' ? t('platform.suspendedBody') : reason === 'reserved-slug' ? t('platform.reservedBody', { host }) : t('platform.unknownBody', { host })}
          </p>
        </section>
      </main>
      <footer className="container pf__foot">
        <Credit copyright={false} />
      </footer>
    </div>
  );
}

export function PlatformRoot({ host }: { host: Extract<HostKind, { kind: 'platform' }> }) {
  return <UnknownHost reason={host.reason === 'root' ? 'unknown-host' : host.reason} attempted={host.attempted} />;
}
