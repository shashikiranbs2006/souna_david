/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Registrable platform domain; reseller storefronts live on `{slug}.<domain>`. */
  readonly VITE_PLATFORM_DOMAIN?: string;
  /** Single-shop edition: slug of the one shop (runtime `singleShop` in /config.js wins). */
  readonly VITE_SINGLE_SHOP?: string;
  /** Languages offered, comma separated, first = fallback (runtime `locales` wins). */
  readonly VITE_LOCALES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
