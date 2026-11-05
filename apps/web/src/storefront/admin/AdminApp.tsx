import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { BarChart3, Boxes, Contact, FileText, Inbox, Receipt, SlidersHorizontal, LayoutDashboard, Store, Users, ExternalLink as ExternalIcon } from 'lucide-react';
import { useTenantData } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { Icon } from '../../design/components/Icon.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { AdminShell } from '../../staff/AdminShell.tsx';
import { RequireStaff } from '../../staff/RequireStaff.tsx';
import { Dashboard } from './Dashboard.tsx';
import { RequestDetail, RequestsList } from './Requests.tsx';
import { ContactDetail, ContactsList, NewOffer, OfferDetail } from './Contacts.tsx';
import { CommandBox } from './CommandBox.tsx';
import { InvoiceDetail, InvoicesList } from './Invoices.tsx';
import { QuotesList, Reports } from './Reports.tsx';
import { CustomerDetail, CustomersList } from './Customers.tsx';
import { ConfigurationDetail, ConfigurationsList, NewConfiguration } from './Configurations.tsx';
import { SaunasAdmin } from './Saunas.tsx';
import { SaunaOptionsAdmin } from './SaunaOptions.tsx';
import { BrandingAdmin } from './Branding.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import './admin.css';

// The 3D configurator (three.js) loads only when David opens it.
const StaffConfigure = lazy(() => import('../pages/Configure.tsx').then(m => ({ default: m.StaffConfigure })));

function Brand() {
  const tenant = useTenantData();
  const b = tenant.branding;
  return (
    <Link to="/admin" className="staff-shell__logo">
      {b.logoUrl ? <img src={b.logoUrl} alt={b.displayName} height={32} /> : b.displayName}
    </Link>
  );
}

function AdminNotFound() {
  const { t } = useT();
  useDocumentTitle(t('notFound.title'));
  return <EmptyState title={t('notFound.title')} body={t('notFound.body')} action={<ButtonLink to="/admin">{t('admin.nav.dashboard')}</ButtonLink>} />;
}

/** Reseller admin at /admin/* on the storefront host, in the reseller's own colours. */
export default function AdminApp() {
  const { t } = useT();
  return (
    <RequireStaff scope="RESELLER" title={t('admin.title')} brand={<Brand />}>
      {session => (
        <AdminShell
          brand={<Brand />}
          area={t('admin.title')}
          session={session}
          nav={[
            { to: '/admin', label: t('admin.nav.dashboard'), icon: LayoutDashboard, end: true },
            { to: '/admin/requests', label: t('admin.nav.requests'), icon: Inbox },
            { to: '/admin/contacts', label: t('admin.nav.contacts'), icon: Contact },
            { to: '/admin/configurations', label: t('admin.nav.configurations'), icon: SlidersHorizontal },
            { to: '/admin/quotes', label: t('admin.nav.quotes'), icon: FileText },
            { to: '/admin/invoices', label: t('admin.nav.invoices'), icon: Receipt },
            { to: '/admin/reports', label: t('admin.nav.reports'), icon: BarChart3 },
            { to: '/admin/customers', label: t('admin.nav.customers'), icon: Users },
            { to: '/admin/saunas', label: t('admin.nav.saunas'), icon: Boxes },
            { to: '/admin/branding', label: t('admin.nav.branding'), icon: Store },
          ]}
          extra={
            <a href="/" className="staff-shell__extra staff-shell__link" target="_blank" rel="noreferrer">
              <Icon icon={ExternalIcon} size="sm" />
              {t('staff.viewStorefront')}
            </a>
          }
        >
          <CommandBox />
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="requests" element={<RequestsList />} />
            <Route path="requests/:id" element={<RequestDetail />} />
            <Route path="contacts" element={<ContactsList />} />
            <Route path="contacts/:id" element={<ContactDetail />} />
            <Route path="contacts/:id/quote" element={<NewOffer />} />
            <Route path="offers/:id" element={<OfferDetail />} />
            <Route path="quotes" element={<QuotesList />} />
            <Route path="invoices" element={<InvoicesList />} />
            <Route path="invoices/:id" element={<InvoiceDetail />} />
            <Route path="reports" element={<Reports />} />
            <Route path="customers" element={<CustomersList />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="configurations" element={<ConfigurationsList />} />
            <Route path="configurations/new" element={<NewConfiguration />} />
            <Route path="configurations/:id" element={<ConfigurationDetail />} />
            <Route path="configure/:slug" element={<Suspense fallback={<Skeleton lines={8} />}><StaffConfigure /></Suspense>} />
            <Route path="saunas" element={<SaunasAdmin />} />
            <Route path="saunas/:id/options" element={<SaunaOptionsAdmin />} />
            <Route path="branding" element={<BrandingAdmin />} />
            {/* Settings now live on the Shop (branding) page. */}
            <Route path="settings" element={<Navigate to="/admin/branding" replace />} />
            <Route path="*" element={<AdminNotFound />} />
          </Routes>
        </AdminShell>
      )}
    </RequireStaff>
  );
}
