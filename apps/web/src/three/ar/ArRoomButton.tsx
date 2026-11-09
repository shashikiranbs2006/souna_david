import { useRef, useState } from 'react';
import { Box } from 'lucide-react';
import { useT } from '../../i18n/i18n.ts';
import { Button } from '../../design/components/Button.tsx';
import type { ViewerOptions, ViewerSpecs } from '../types.ts';
import { ensureArFiles, type ArUrls } from './arFiles.ts';
import './ArRoomButton.css';

/**
 * "View in your room" for the exact configured sauna on a share link: the
 * phone's own AR viewer shows it on the floor at true size, starting outside
 * and facing the door.
 *   iPhone / iPad  -> Quick Look with the USDZ (scaling locked)
 *   Android        -> Scene Viewer with the GLB (resizing off)
 *   desktop        -> a note that AR works on phones (ARCore / ARKit)
 * The first tap prepares the files (export + upload, once per visit); the
 * next tap opens the viewer. Opening needs a fresh tap: Safari and Chrome only
 * hand over to Quick Look or Scene Viewer from a user gesture.
 *
 * Platform detection, the Scene Viewer intent and the Quick Look anchor are
 * ported verbatim from the owner's earlier studio (app/client/studio/ArPage.tsx).
 */
type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  // Quick Look is detected by the <a rel="ar"> capability, not the user agent alone.
  if (document.createElement('a').relList?.supports?.('ar')) return 'ios';
  if (/android/i.test(navigator.userAgent)) return 'android';
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

export function sceneViewerIntent(glbUrl: string, title: string, backUrl: string): string {
  const params = new URLSearchParams({ file: glbUrl, mode: 'ar_preferred', resizable: 'false', title, link: backUrl });
  return `intent://arvr.google.com/scene-viewer/1.2?${params.toString()}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(backUrl)};end;`;
}

/** Quick Look needs an <img> child in the anchor; any image will do (it is never shown). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

type State = { status: 'idle' | 'preparing' | 'ready' | 'error' | 'unsupported'; urls?: ArUrls };

export function ArRoomButton({ shareToken, name, specs, options, thumbnailUrl }: { shareToken: string; name: string; specs: ViewerSpecs; options: ViewerOptions; thumbnailUrl?: string | null }) {
  const { t } = useT();
  const [platform] = useState<Platform>(detectPlatform);
  const [state, setState] = useState<State>({ status: 'idle' });
  const quickLook = useRef<HTMLAnchorElement>(null);

  const prepare = async () => {
    setState({ status: 'preparing' });
    try {
      setState({ status: 'ready', urls: await ensureArFiles(shareToken, specs, options) });
    } catch (e) {
      console.warn('[ar] could not prepare the AR files', e);
      setState({ status: 'error' });
    }
  };

  const onClick = () => {
    if (platform === 'desktop') return setState({ status: 'unsupported' });
    if (state.status === 'preparing') return;
    const u = state.urls;
    // Signed URLs are short-lived: refresh them (cheap, the files are stored) when close to expiry.
    if (state.status !== 'ready' || !u || u.expiresAt - Date.now() < 30_000) return void prepare();
    if (platform === 'ios') quickLook.current?.click();
    else location.href = sceneViewerIntent(u.glbUrl, name, location.href);
  };

  const message =
    state.status === 'preparing' ? t('arRoom.preparing')
    : state.status === 'ready' ? t('arRoom.ready')
    : state.status === 'error' ? t('arRoom.error')
    : state.status === 'unsupported' ? t('arRoom.notSupported')
    : null;

  return (
    <div className="ar-room">
      <Button variant="ghost" icon={Box} onClick={onClick} loading={state.status === 'preparing'} aria-describedby={message ? 'ar-room-status' : undefined}>
        {state.status === 'ready' ? t('arRoom.open') : t('arRoom.button')}
      </Button>
      {message && (
        <p id="ar-room-status" className={`ar-room__status${state.status === 'error' ? ' is-error' : ''}`} role={state.status === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      {/* Quick Look needs a real <a rel="ar"> with an <img> child. */}
      {platform === 'ios' && state.status === 'ready' && state.urls && (
        <a ref={quickLook} rel="ar" href={`${state.urls.usdzUrl}#allowsContentScaling=0`} className="ar-room__hidden" aria-hidden="true" tabIndex={-1}>
          <img alt="" src={thumbnailUrl ?? BLANK} />
        </a>
      )}
    </div>
  );
}
