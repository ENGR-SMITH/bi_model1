// ---------------------------------------------------------------------------
// CoverflowCarousel — the first column of a role page. A 3D coverflow shelf
// that mixes the project's timeline versions with its vault uploads. The
// active (latest) item sits dead-centre at maximum scale and full opacity;
// neighbours recede with a rotateY + translateZ fan and fade towards the
// edges, so any item can be brought to the focal point by scrolling or using
// the arrows.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Clock3, FileVideo2, Image as ImageIcon, Mic2 } from 'lucide-react';

export type CoverflowItem =
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

export function CoverflowCarousel({
  items,
  activeKey,
  onSelect,
  emptyText,
}: {
  items: CoverflowItem[];
  /** The currently-active item's key (the one held at the focal point). */
  activeKey: string | null;
  onSelect: (key: string) => void;
  emptyText: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Each card's 3D pose is a function of its distance from the track's centre
  // — the centred card is scale(1) / opacity(1), neighbours fan away.
  const applyTransforms = useCallback(() => {
    const container = trackRef.current;
    if (!container) return;
    const center = container.clientWidth / 2;
    for (const child of Array.from(container.children) as HTMLElement[]) {
      const itemCenter = child.offsetLeft + child.offsetWidth / 2 - container.scrollLeft;
      const dist = itemCenter - center;
      const ratio = dist / (container.clientWidth * 0.5);
      const abs = Math.min(1, Math.abs(ratio));
      child.style.transform =
        `translateX(${dist * 0.2}px) translateZ(${-abs * 90}px) rotateY(${-ratio * 32}deg) scale(${1 - abs * 0.3})`;
      child.style.opacity = String(1 - abs * 0.62);
      child.style.zIndex = String(Math.round(100 - abs * 90));
    }
  }, []);

  // Re-pose on scroll (rAF-throttled) and whenever the shelf changes size.
  useEffect(() => {
    const container = trackRef.current;
    if (!container) return;
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyTransforms();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    applyTransforms();
    const observer = new ResizeObserver(() => applyTransforms());
    observer.observe(container);
    return () => {
      container.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [applyTransforms, items.length]);

  const scrollToKey = (key: string) => {
    const container = trackRef.current;
    if (!container) return;
    const el = Array.from(container.children).find((child) => (child as HTMLElement).dataset.key === key) as HTMLElement | null;
    if (!el) return;
    container.scrollTo({ left: el.offsetLeft - (container.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
  };

  // Keep the active item pinned at the focal point whenever it changes.
  useEffect(() => {
    if (activeKey) scrollToKey(activeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const step = (dir: 1 | -1) => {
    const container = trackRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) return;
    const center = container.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDist = Infinity;
    children.forEach((child, index) => {
      const itemCenter = child.offsetLeft + child.offsetWidth / 2 - container.scrollLeft;
      const dist = Math.abs(itemCenter - center);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = index;
      }
    });
    const target = children[Math.min(children.length - 1, Math.max(0, nearestIndex + dir))];
    container.scrollTo({ left: target.offsetLeft - (container.clientWidth - target.offsetWidth) / 2, behavior: 'smooth' });
  };

  return (
    <div className="paper-card cf-card" data-testid="coverflow">
      <div className="inline-heading">
        <span className="eyebrow"><Clock3 size={13} /> Timeline versions · vault</span>
        <span className="mono-label">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="setting-copy mt-2" data-testid="coverflow-empty">{emptyText}</p>
      ) : (
        <div className="cf-stage">
          <button type="button" className="cf-arrow" onClick={() => step(-1)} aria-label="Previous item" data-testid="coverflow-prev">
            <ChevronLeft size={15} />
          </button>
          <div className="cf-track" ref={trackRef} data-testid="coverflow-track">
            {items.map((item) => {
              const active = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  data-key={item.key}
                  className={`cf-item ${active ? 'active' : ''}`}
                  onClick={() => {
                    onSelect(item.key);
                    scrollToKey(item.key);
                  }}
                  data-testid={`coverflow-item-${item.key}`}
                >
                  {item.kind === 'version' ? (
                    <>
                      <span className="cf-thumb">
                        <span className="cf-version-mark">v{item.version}</span>
                        <span className="cf-badges">
                          <span className="den-tag accent">{item.leg}</span>
                          {item.isHead && <span className="den-tag teal">head</span>}
                        </span>
                      </span>
                      <span className="cf-body">
                        <span className={`cf-title ${item.message ? '' : 'muted'}`}>{item.message || 'no message'}</span>
                        <span className="cf-meta">
                          {new Date(item.createdAt).toLocaleDateString()} · {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="cf-thumb">
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
                          <span className="cf-thumb-icon">
                            {item.media === 'audio' ? <Mic2 size={22} /> : item.media === 'image' ? <ImageIcon size={22} /> : <FileVideo2 size={22} />}
                          </span>
                        )}
                        <span className="cf-badges">
                          <span className="den-tag accent">{item.kindLabel}</span>
                          {item.status !== 'PROCESSED' && <span className="den-tag gold">processing</span>}
                        </span>
                      </span>
                      <span className="cf-body">
                        <span className="cf-title">{item.fileName}</span>
                        <span className="cf-meta">{item.status === 'PROCESSED' ? 'in the vault' : 'processing…'}</span>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <button type="button" className="cf-arrow" onClick={() => step(1)} aria-label="Next item" data-testid="coverflow-next">
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
