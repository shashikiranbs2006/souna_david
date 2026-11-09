/**
 * Every lazily loaded page, in one table: the routers use these loaders for
 * `lazy` routes and the prefetcher calls the same functions on hover/focus,
 * so a prefetched chunk is exactly the one the router will ask for.
 * Each import is its own chunk; the shop and the admin never share page code.
 */
export const pages = {
  home: () => import('../storefront/pages/Home.tsx'),
  saunas: () => import('../storefront/pages/Saunas.tsx'),
  sauna: () => import('../storefront/pages/SaunaDetail.tsx'),
  shared: () => import('../storefront/pages/Shared.tsx'),
  guide: () => import('../storefront/pages/Guide.tsx'),
  how: () => import('../storefront/pages/HowItWorks.tsx'),
  about: () => import('../storefront/pages/About.tsx'),
  faq: () => import('../storefront/pages/Faq.tsx'),
  contact: () => import('../storefront/pages/Contact.tsx'),
  legal: () => import('../storefront/pages/Legal.tsx'),
  notFound: () => import('../storefront/pages/NotFound.tsx'),
  admin: () => import('../storefront/admin/AdminApp.tsx'),
} as const;

export type PageName = keyof typeof pages;
