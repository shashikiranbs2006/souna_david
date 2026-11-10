import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { LogOut, Menu, X } from 'lucide-react';
import { useLogout } from '../api/queries.ts';
import { useT, type TKey } from '../i18n/i18n.ts';
import { Icon } from '../design/components/Icon.tsx';
import { Toaster } from '../design/components/Toast.tsx';
import { NavigationProgress } from '../motion/PageTransition.tsx';
import { Credit } from '../design/components/Credit.tsx';
import { FlipText } from '../motion/FlipText.tsx';
import { gsap } from '../motion/gsap.ts';
import { prefersReducedMotion } from '../motion/preferences.ts';
import { LanguageSwitcher } from '../storefront/layout/LanguageSwitcher.tsx';
import type { StaffSession } from './RequireStaff.tsx';
import './staff.css';

export interface ShellNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/**
 * Frame of both admin areas: one navigation (sidebar on desktop, scrolling tab
 * bar on phones), the signed-in staff block and the routed page.
 */
export function AdminShell({ brand, area, nav, session, extra, children }: { brand: ReactNode; area: string; nav: ShellNavItem[]; session: StaffSession; extra?: ReactNode; children?: ReactNode }) {
  const { t } = useT();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const content = useRef<HTMLDivElement>(null);
  // Phones and tablets: the navigation sits behind a menu button; it closes after every page change.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // A short rise on every page change; the global progress bar covers loading.
  useEffect(() => {
    const el = content.current;
    if (!el || prefersReducedMotion()) return;
    const tween = gsap.fromTo(el, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'sk.out', clearProps: 'all' });
    return () => void tween.kill();
  }, [pathname]);

  return (
    <>
      <a href="#main" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <NavigationProgress />
      <div className="staff-shell">
      <aside className="staff-shell__side">
        <div className="staff-shell__brand">
          {brand}
          <p className="staff-shell__area mono">{area}</p>
        </div>
        <button type="button" className="staff-shell__menu" aria-expanded={menuOpen} aria-controls="staff-nav" onClick={() => setMenuOpen(o => !o)}>
          <Icon icon={menuOpen ? X : Menu} size="sm" />
          {t('staff.menu')}
        </button>
        <nav id="staff-nav" className={['staff-shell__nav', menuOpen && 'is-open'].filter(Boolean).join(' ')} aria-label={area}>
          <ul>
            {nav.map(item => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => ['staff-shell__link', isActive && 'is-active'].filter(Boolean).join(' ')}>
                  <Icon icon={item.icon} size="sm" />
                  <FlipText text={item.label} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="staff-shell__foot">
          {extra}
          <div className="staff-shell__user">
            <span className="staff-shell__avatar" aria-hidden="true">
              {session.staff.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="staff-shell__who">
              <span className="staff-shell__name">{session.staff.displayName}</span>
              <span className="staff-shell__role mono">{t(`staff.roles.${session.staff.role}` as TKey)}</span>
            </span>
          </div>
          <div className="staff-shell__tools">
            <LanguageSwitcher compact />
            <button
              type="button"
              className="staff-shell__logout"
              onClick={() => logout.mutate(undefined, { onSettled: () => navigate(pathname, { replace: true }) })}
              disabled={logout.isPending}
            >
              <Icon icon={LogOut} size="sm" />
              {t('staff.logout')}
            </button>
          </div>
          <Credit quiet copyright={false} className="staff-shell__credit" />
        </div>
      </aside>
      <div className="staff-shell__main">
        <main id="main" tabIndex={-1} className="staff-shell__content" ref={content}>
          {children ?? <Outlet />}
        </main>
        {/* Phones and tablets: the credit closes the page instead of crowding the top bar. */}
        <Credit quiet copyright={false} className="staff-shell__credit staff-shell__credit--end" />
      </div>
      </div>
      <Toaster />
    </>
  );
}
