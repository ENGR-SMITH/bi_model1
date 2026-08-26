// ---------------------------------------------------------------------------
// VersionShelf — the first column of a role page. A vertical 3D coverflow
// carousel that stacks the leg's timeline versions together with the vault's
// uploads. A static blue focus frame is pinned in the upper part of the
// column — the active (latest) item sits inside it at full scale and full
// opacity, with about one card's height of space above the frame and the
// next card below, while the remaining neighbours recede with a rotateX +
// translateZ tilt and fade towards the edges. The list itself scrolls under
// the fixed frame — scroll (wheel / drag / trackbar) or use the arrows to
// bring any item into the frame, which then becomes the active selection.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, FileVideo2, Image as ImageIcon, Mic2 } from 'lucide-react';

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

// The focal point sits in the upper part of the column (25% down) instead of
// dead centre, so the newest (active) card rests inside the frame with about
// one card's height of space above it and the next card below.
const FOCUS_RATIO = 0.25;

export function VersionShelf({
  items,
  activeKey,
  onSelect,
  emptyText,
}: {
  items: ShelfItem[];
  /** The currently-active item's key (held inside the focus frame). */
  activeKey: string | null;
  onSelect: (key: string) => void;
  emptyText: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  // Give the track padding above and below the cards (down to the focal
  // point above, and the remainder below), so the list is ALWAYS scrollable
  // — even with just one or two cards — and the first / last cards can still
  // be brought up into the fixed focus frame. (CSS percentage padding would
  // resolve against the column's width, which is too small to matter.)
  const syncPadding = useCallback(() => {
    const container = trackRef.current;
    if (!container) return;
    const top = container.clientHeight * FOCUS_RATIO;
    container.style.paddingTop = `${top}px`;
    container.style.paddingBottom = `${container.clientHeight - top}px`;
  }, []);

  useLayoutEffect(() => {
    syncPadding();
  }, [syncPadding, items.length]);

  // The item whose centre is closest to the track's focal point.
  const findNearestKey = useCallback((container: HTMLDivElement): string | null => {
    const center = container.clientHeight * FOCUS_RATIO;
    let nearestKey: string | null = null;
    let nearestDist = Infinity;
    for (const child of Array.from(container.children) as HTMLElement[]) {
      const itemCenter = child.offsetTop + child.offsetHeight / 2 - container.scrollTop;
      const dist = Math.abs(itemCenter - center);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestKey = child.dataset.key ?? null;
      }
    }
    return nearestKey;
  }, []);

  // Each card's 3D pose is a function of its distance from the track's focal
  // point — the card in the frame is scale(1) / opacity(1), the cards above
  // and below fan away with a rotateX + translateZ tilt. The focus frame's
  // height tracks the card currently sitting inside it.
  const applyTransforms = useCallback(() => {
    const container = trackRef.current;
    if (!container) return;
    const center = container.clientHeight * FOCUS_RATIO;
    let nearest: HTMLElement | null = null;
    let nearestDist = Infinity;
    for (const child of Array.from(container.children) as HTMLElement[]) {
      const itemCenter = child.offsetTop + child.offsetHeight / 2 - container.scrollTop;
      const dist = itemCenter - center;
      const ratio = dist / (container.clientHeight * 0.5);
      const abs = Math.min(1, Math.abs(ratio));
      child.style.transform =
        `translateY(${dist * 0.18}px) translateZ(${-abs * 90}px) rotateX(${ratio * 30}deg) scale(${1 - abs * 0.34})`;
      child.style.opacity = String(1 - abs * 0.65);
      child.style.zIndex = String(Math.round(100 - abs * 90));
      const absDist = Math.abs(dist);
      if (absDist < nearestDist) {
        nearestDist = absDist;
        nearest = child;
      }
    }
    const focus = focusRef.current;
    if (focus && nearest) {
      focus.style.height = `${nearest.offsetHeight}px`;
    }
  }, []);

  // Re-pose on scroll (rAF-throttled), and once the user stops scrolling,
  // promote whatever item has settled inside the focus frame to the active
  // selection.
  useEffect(() => {
    const container = trackRef.current;
    if (!container) return;
    const onScroll = () => {
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          applyTransforms();
        });
      }
      if (settleRef.current != null) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        settleRef.current = null;
        const key = findNearestKey(container);
        if (key && key !== activeKeyRef.current) onSelect(key);
      }, 180);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    syncPadding();
    applyTransforms();
    const observer = new ResizeObserver(() => {
      syncPadding();
      applyTransforms();
    });
    observer.observe(container);
    return () => {
      container.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (settleRef.current != null) window.clearTimeout(settleRef.current);
    };
  }, [applyTransforms, findNearestKey, onSelect, items.length, syncPadding]);

  const scrollToKey = (key: string) => {
    const container = trackRef.current;
    if (!container) return;
    const el = Array.from(container.children).find((child) => (child as HTMLElement).dataset.key === key) as HTMLElement | null;
    if (!el) return;
    const focal = container.clientHeight * FOCUS_RATIO;
    container.scrollTo({ top: el.offsetTop - (focal - el.offsetHeight / 2), behavior: 'smooth' });
  };

  // Keep the active item pinned inside the focus frame whenever it changes.
  useEffect(() => {
    if (activeKey) scrollToKey(activeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const step = (dir: 1 | -1) => {
    const container = trackRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) return;
    const center = container.clientHeight * FOCUS_RATIO;
    let nearestIndex = 0;
    let nearestDist = Infinity;
    children.forEach((child, index) => {
      const itemCenter = child.offsetTop + child.offsetHeight / 2 - container.scrollTop;
      const dist = Math.abs(itemCenter - center);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = index;
      }
    });
    const target = children[Math.min(children.length - 1, Math.max(0, nearestIndex + dir))];
    container.scrollTo({ top: target.offsetTop - (container.clientHeight - target.offsetHeight) / 2, behavior: 'smooth' });
  };

  return (
    <div className="paper-card pv-versions-list" data-testid="version-shelf">
      {items.length === 0 ? (
        <p className="setting-copy mt-2" data-testid="version-shelf-empty">{emptyText}</p>
      ) : (
        <div className="vs-wrap">
          <button type="button" className="vs-arrow" onClick={() => step(-1)} aria-label="Earlier items" data-testid="shelf-prev">
            <ChevronUp size={14} />
          </button>
          <div className="vs-viewport">
            <div className="vs-focus" ref={focusRef} data-testid="shelf-focus" />
            <div className="vs-track" ref={trackRef} data-testid="version-shelf-track">
              {items.map((item) => {
                const active = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-key={item.key}
                    className={`vs-item ${active ? 'active' : ''}`}
                    onClick={() => onSelect(item.key)}
                    data-testid={`shelf-item-${item.key}`}
                  >
                    {item.kind === 'version' ? (
                      <>
                        <span className="vs-item-head">
                          <span className="den-tag accent">v{item.version}</span>
                          <span className="vs-leg">{item.leg}</span>
                          {item.isHead && <span className="den-tag teal">head</span>}
                        </span>
                        <span className={`vs-title ${item.message ? '' : 'muted'}`}>{item.message || 'no message'}</span>
                        <span className="vs-meta">
                          {new Date(item.createdAt).toLocaleDateString()} · {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="vs-item-head">
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
                          <span className="vs-leg">{item.kindLabel}</span>
                          {item.status !== 'PROCESSED' && <span className="den-tag gold">processing</span>}
                        </span>
                        <span className="vs-title">{item.fileName}</span>
                        <span className="vs-meta">{item.status === 'PROCESSED' ? 'in the vault' : 'processing…'}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" className="vs-arrow" onClick={() => step(1)} aria-label="Later items" data-testid="shelf-next">
            <ChevronDown size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
