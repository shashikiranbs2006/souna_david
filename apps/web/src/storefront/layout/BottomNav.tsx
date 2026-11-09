import { Link, useLocation } from 'react-router';
import { Flame, FileText, Mail, type LucideIcon } from 'lucide-react';
import { Icon } from '../../design/components/Icon.tsx';
import { useT, type TKey } from '../../i18n/i18n.ts';
import './BottomNav.css';

interface Item {
  to: string;
  key: TKey;
  icon: LucideIcon;
  active: (path: string) => boolean;
}

/** Fixed tab bar for phones and small tablets (hidden on desktop, where the header nav shows). */
export function BottomNav() {
  const { t } = useT();
  const { pathname } = useLocation();
  const items: Item[] = [
    { to: '/saunas', key: 'nav.saunas', icon: Flame, active: p => p.startsWith('/saunas') },
    { to: '/how-it-works', key: 'nav.howItWorks', icon: FileText, active: p => p.startsWith('/how-it-works') },
    { to: '/contact', key: 'nav.contact', icon: Mail, active: p => p.startsWith('/contact') },
  ];

  return (
    <nav className="bnav" aria-label={t('nav.bottom')}>
      <ul className="bnav__list">
        {items.map(i => {
          const on = i.active(pathname);
          return (
            <li key={i.key}>
              <Link to={i.to} className="bnav__link" aria-current={on ? 'page' : undefined}>
                <Icon icon={i.icon} size="md" />
                <span className="bnav__label">{t(i.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
