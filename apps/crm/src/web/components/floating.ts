import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const GAP = 4;
const EDGE = 8;

interface FloatingOptions {
  minWidth?: number;
  maxHeight?: number;
  /** `end` lines the popup's right edge up with the anchor's (a "⋯" menu at the right of a row). */
  align?: 'start' | 'end';
  /** Widen the popup to the anchor (a field's option list). Off for menus, which size to their items. */
  matchWidth?: boolean;
}

function placeUnder(
  anchor: HTMLElement | null,
  { minWidth = 0, maxHeight = 320, align = 'start', matchWidth = true }: FloatingOptions,
): CSSProperties | undefined {
  if (!anchor) return undefined;
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(matchWidth ? r.width : 0, minWidth), vw - EDGE * 2);
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  // Open upward only when the full popup does not fit below and there is more room above.
  const placeAbove = below < maxHeight && above > below;
  const room = Math.max(120, Math.min(maxHeight, placeAbove ? above : below));
  // A popup that sizes to its content and hangs from the anchor's right edge is placed by `right`, so it grows leftward.
  const horizontal: CSSProperties = align === 'end' && !matchWidth
    ? { right: Math.max(EDGE, vw - r.right), minWidth: width, maxWidth: vw - EDGE * 2 }
    : {
        left: Math.min(Math.max(align === 'end' ? r.right - width : r.left, EDGE), vw - width - EDGE),
        ...(matchWidth ? { width } : { minWidth: width, maxWidth: vw - EDGE * 2 }),
      };
  return placeAbove
    ? { position: 'fixed', ...horizontal, bottom: vh - r.top + GAP, maxHeight: room }
    : { position: 'fixed', ...horizontal, top: r.bottom + GAP, maxHeight: room };
}

/**
 * Fixed-position coordinates for a popup under (or, without room, above) its anchor. Fixed positioning keeps the popup
 * out of the clipping of a scrolling dialog body; the position follows scrolling and resizing while it is open.
 * The anchor is already on the page when a popup opens, so the first render is placed too.
 */
export function useFloatingStyle(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  options: FloatingOptions = {},
): CSSProperties | undefined {
  const { minWidth, maxHeight, align, matchWidth } = options;
  const [style, setStyle] = useState<CSSProperties | undefined>(() => (open ? placeUnder(anchorRef.current, options) : undefined));

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined);
      return;
    }
    let frame = 0;
    const place = () => setStyle(placeUnder(anchorRef.current, { minWidth, maxHeight, align, matchWidth }));
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [open, anchorRef, minWidth, maxHeight, align, matchWidth]);

  return style;
}
