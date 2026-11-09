import { createAppRouter } from '../app/router.ts';
import { Navigate, useParams, type RouteObject } from 'react-router';
import { pages } from '../app/pages.ts';
import { RouteErrorPage } from '../design/components/ErrorBoundary.tsx';
import { StorefrontRoot, ShellSkeleton } from './StorefrontRoot.tsx';

type Mod = Record<string, unknown> & { default?: unknown };
const lazy = (load: () => Promise<Mod>, name = 'default') => async () => {
  const m = await load();
  return { Component: m[name] as React.ComponentType };
};

function ToProduct() {
  const { slug } = useParams();
  return <Navigate to={`/saunas/${slug ?? ''}`} replace />;
}

const routes: RouteObject[] = [
  {
    path: '/',
    element: <StorefrontRoot />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <ShellSkeleton />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, lazy: lazy(pages.home) },
          { path: 'saunas', lazy: lazy(pages.saunas) },
          { path: 'saunas/:slug', lazy: lazy(pages.sauna) },
          // Customers have no configurator: the shop configures with them (old links go to the sauna).
          { path: 'saunas/:slug/configure', element: <ToProduct /> },
          { path: 's/:token', lazy: lazy(pages.shared) },
          { path: 'showroom', element: <Navigate to="/saunas" replace /> },
          { path: 'guide', lazy: lazy(pages.guide) },
          { path: 'how-it-works', lazy: lazy(pages.how) },
          { path: 'about', lazy: lazy(pages.about) },
          { path: 'faq', lazy: lazy(pages.faq) },
          { path: 'contact', lazy: lazy(pages.contact) },
          { path: 'legal/:doc', lazy: lazy(pages.legal) },
          { path: 'admin/*', lazy: lazy(pages.admin) },
          { path: '*', lazy: lazy(pages.notFound) },
        ],
      },
    ],
  },
];

export function createStorefrontRouter() {
  return createAppRouter(routes);
}
