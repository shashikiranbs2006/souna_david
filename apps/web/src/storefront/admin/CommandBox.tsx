import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api/client.ts';
import { useT } from '../../i18n/i18n.ts';
import { Input } from '../../design/components/Field.tsx';

/** What a typed line means. Pure, so it can be tested without the page. */
export type Command =
  | { kind: 'go'; to: string }
  | { kind: 'open'; number: number }
  | { kind: 'unknown' };

export function parseCommand(raw: string): Command {
  const s = raw.trim().replace(/\s+/g, ' ');
  const lower = s.toLowerCase();
  // English first; the German, French and Italian phrasings are the same commands.
  if (/^((new|add|create) quote|neue offerte|nouvelle offre|nuova offerta)$/.test(lower)) return { kind: 'go', to: '/admin/contacts' };
  const find = /^(?:find|search|suche|suchen|chercher|cherche|cerca)\s+(.+)$/i.exec(s);
  if (find) return { kind: 'go', to: `/admin/contacts?q=${encodeURIComponent(find[1]!)}` };
  const open = /^(?:open|öffne|öffnen|ouvrir|apri)\s+(?:q-?)?(\d{1,9})$/i.exec(s);
  if (open) return { kind: 'open', number: Number(open[1]) };
  if (/^((list|show) open quotes|offene offerten|offres ouvertes|offerte aperte)$/.test(lower)) return { kind: 'go', to: '/admin/quotes?open=1' };
  if (/^((list|show) (expiring|expiring links)|ablaufende links|liens expirants|link in scadenza)$/.test(lower)) return { kind: 'go', to: '/admin/reports?show=expiring' };
  if (/^(report|reports|berichte|rapports|rapporti)$/.test(lower)) return { kind: 'go', to: '/admin/reports' };
  return { kind: 'unknown' };
}

/** One line to type a command: "new quote", "find Müller", "open Q-1024", "list open quotes", "list expiring links". */
export function CommandBox() {
  const { t } = useT();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const cmd = parseCommand(text);
    setMsg(null);
    if (cmd.kind === 'go') { navigate(cmd.to); setText(''); return; }
    if (cmd.kind === 'open') {
      try {
        const r = await api('adminOffers', { query: { number: cmd.number } });
        const hit = r.items[0];
        if (hit) { navigate(`/admin/offers/${hit.id}`); setText(''); } else setMsg(t('admin.command.noQuote', { number: String(cmd.number) }));
      } catch { setMsg(t('admin.command.failed')); }
      return;
    }
    setMsg(t('admin.command.unknown'));
  };
  return (
    <form className="staff-command" onSubmit={e => void run(e)} role="search" aria-label={t('admin.command.label')}>
      <Input label={t('admin.command.label')} placeholder={t('admin.command.placeholder')} value={text} onChange={e => setText(e.target.value)} />
      {msg && <p className="staff-muted" role="status">{msg}</p>}
    </form>
  );
}
