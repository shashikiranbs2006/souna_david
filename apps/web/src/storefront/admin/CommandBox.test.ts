import { describe, expect, it } from 'vitest';
import { parseCommand } from './CommandBox.tsx';

describe('parseCommand', () => {
  it('understands the five commands', () => {
    expect(parseCommand('new quote')).toEqual({ kind: 'go', to: '/admin/contacts' });
    expect(parseCommand('  Find   Müller ')).toEqual({ kind: 'go', to: '/admin/contacts?q=M%C3%BCller' });
    expect(parseCommand('open Q-1024')).toEqual({ kind: 'open', number: 1024 });
    expect(parseCommand('open 1025')).toEqual({ kind: 'open', number: 1025 });
    expect(parseCommand('list open quotes')).toEqual({ kind: 'go', to: '/admin/quotes?open=1' });
    expect(parseCommand('list expiring links')).toEqual({ kind: 'go', to: '/admin/reports?show=expiring' });
  });
  it('understands the same commands in German, French and Italian', () => {
    expect(parseCommand('neue Offerte')).toEqual({ kind: 'go', to: '/admin/contacts' });
    expect(parseCommand('suche Müller')).toEqual({ kind: 'go', to: '/admin/contacts?q=M%C3%BCller' });
    expect(parseCommand('öffne Q-1024')).toEqual({ kind: 'open', number: 1024 });
    expect(parseCommand('Offene Offerten')).toEqual({ kind: 'go', to: '/admin/quotes?open=1' });
    expect(parseCommand('ablaufende Links')).toEqual({ kind: 'go', to: '/admin/reports?show=expiring' });
    expect(parseCommand('ouvrir Q-1024')).toEqual({ kind: 'open', number: 1024 });
    expect(parseCommand('liens expirants')).toEqual({ kind: 'go', to: '/admin/reports?show=expiring' });
    expect(parseCommand('apri 1025')).toEqual({ kind: 'open', number: 1025 });
    expect(parseCommand('offerte aperte')).toEqual({ kind: 'go', to: '/admin/quotes?open=1' });
  });
  it('rejects anything else', () => {
    expect(parseCommand('delete everything')).toEqual({ kind: 'unknown' });
    expect(parseCommand('open Q-')).toEqual({ kind: 'unknown' });
  });
});
