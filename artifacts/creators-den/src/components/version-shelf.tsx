// ---------------------------------------------------------------------------
// VersionShelf — the first column of a role page. A vertical scrolling
// carousel that stacks the leg's timeline versions together with the vault's
// uploads as rows (versions show v-tag + leg + message, uploads show a proxy
// thumbnail + kind). The active item is highlighted and kept in view; the
// up/down arrows nudge the track, and the wheel/trackbar scroll as usual.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Clock3, FileVideo2, Image as ImageIcon, Mic2 } from 'lucide-react';

export type ShelfItem =
  | {
      key: string;
      kind: 'version';
      version: number;
      leg: string;
      message: string;
      createdAt: string;
      isHead: boolean;
    }
  | {
      key: string;
      kind: 'asset';
      fileName: string;
      kindLabel: string;
      status: string;
      media: 'video' | 'audio' | 'image';
      /** Proxy stream for the thumbnail — present once the asset is PROCESSED. */
      thumbUrl?: string;
    };

export function VersionShelf({
  items,
  activeKey,
  onSelect,
  emptyText,
}: {
  items: ShelfItem[];
  /** The currently-active item's key (highlighted + kept in view). */
  activeKey: string | null;
  onSelect: (key: string) => void;
  emptyText: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  // Keep the active item in view whenever it changes (initial + selection).
  useEffect(() => {
    const container = trackRef.current;
    if (!container) return;
    const el = Array.from(container.children).find((child) => (child as HTMLElement).dataset.key === activeKey) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeKey]);

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * 120, behavior: 'smooth' });
  };

  return (
    <div className="paper-card pv-versions-list" data-testid="version-shelf">
      <div className="inline-heading">
        <span className="eyebrow"><Clock3 size={13} /> Timeline versions · vault</span>
        <span className="mono-label">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="setting-copy mt-2" data-testid="version-shelf-empty">{emptyText}</p>
      ) : (
        <div className="vs-wrap">
          <button type="button" className="vs-arrow" onClick={() => scrollBy(-1)} aria-label="Earlier items" data-testid="shelf-prev">
            <ChevronUp size={14} />
          </button>
          <div className="vs-track" ref={trackRef} data-testid="version-shelf-track">
            {items.map((item) => {
              const active = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  data-key={item.key}
                  className={`pv-version-row ${active ? 'active' : ''}`}
                  onClick={() => onSelect(item.key)}
                  data-testid={`shelf-item-${item.key}`}
                >
                  {item.kind === 'version' ? (
                    <>
                      <span className="pv-version-row-head">
                        <span className="den-tag accent">v{item.version}</span>
                        <span className="pv-version-leg">{item.leg}</span>
                        {item.isHead && <span className="den-tag teal">head</span>}
                      </span>
                      {item.message ? <b className="pv-version-msg truncate">{item.message}</b> : <b className="pv-version-msg muted">no message</b>}
                      <span className="pv-version-date">
                        {new Date(item.createdAt).toLocaleDateString()} · {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="pv-version-row-head">
                        <span className="vs-thumb">
                          {item.thumbUrl && item.media !== 'audio' ? (
                            item.media === 'image' ? (
                              <img
                                src={item.thumbUrl}
                                alt=""
                                loading="lazy"
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <video src={`${item.thumbUrl}#t=0.5`} muted playsInline preload="metadata" />
                            )
                          ) : (
                            item.media === 'audio' ? <Mic2 size={15} /> : item.media === 'image' ? <ImageIcon size={15} /> : <FileVideo2 size={15} />
                          )}
                        </span>
                        <span className="pv-version-leg">{item.kindLabel}</span>
                        {item.status !== 'PROCESSED' && <span className="den-tag gold">processing</span>}
                      </span>
                      <b className="pv-version-msg truncate">{item.fileName}</b>
                      <span className="pv-version-date">{item.status === 'PROCESSED' ? 'in the vault' : 'processing…'}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <button type="button" className="vs-arrow" onClick={() => scrollBy(1)} aria-label="Later items" data-testid="shelf-next">
            <ChevronDown size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
