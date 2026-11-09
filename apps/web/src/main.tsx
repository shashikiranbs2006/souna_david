import { createRoot } from 'react-dom/client';
import './design/global.css';
import { currentHost } from './host.ts';
import { getLocale, initI18n } from './i18n/i18n.ts';
import { setLanguageProvider } from './api/client.ts';
import { App } from './app/App.tsx';

async function boot() {
  setLanguageProvider(getLocale);
  await initI18n();

  const host = currentHost();
  const router =
    host.kind === 'storefront'
      ? (await import('./storefront/routes.tsx')).createStorefrontRouter()
      : (await import('./platform/routes.tsx')).createPlatformRouter(host);

  createRoot(document.getElementById('root')!).render(<App router={router} />);
}

// The splash never outlives a failed or very slow boot: error screens render under it.
void boot().finally(() => setTimeout(() => void import('./app/splash.ts').then(m => m.hideSplash()), 6000));
