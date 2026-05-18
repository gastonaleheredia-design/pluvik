import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface AutoFitTextProps {
  children: ReactNode;
  /** Maximum font size in px. */
  maxFontPx: number;
  /** Minimum font size in px (won't shrink below this). */
  minFontPx: number;
  /** Extra horizontal space (px) to leave inside the container. */
  reservePx?: number;
  style?: CSSProperties;
  className?: string;
  as?: 'div' | 'span' | 'h1' | 'h2';
}

/**
 * Single-line text that shrinks its font-size to fit its container width.
 * Measures the rendered text and scales down until it fits, never clipping.
 */
export function AutoFitText({
  children,
  maxFontPx,
  minFontPx,
  reservePx = 0,
  style,
  className,
  as = 'div',
}: AutoFitTextProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [fontPx, setFontPx] = useState(maxFontPx);
  const fontPxRef = useRef(maxFontPx);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    let raf = 0;

    const fit = () => {
      const available = container.clientWidth - reservePx;
      if (available <= 0) return;
      // Start at max, scale down based on measured width.
      text.style.fontSize = `${maxFontPx}px`;
      const measured = text.scrollWidth;
      const next = measured <= available
        ? maxFontPx
        : Math.max(minFontPx, Math.floor((maxFontPx * available) / measured));
      if (fontPxRef.current !== next) {
        fontPxRef.current = next;
        setFontPx(next);
      }
    };

    fit();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [children, maxFontPx, minFontPx, reservePx]);

  const Tag = as as 'div';
  return (
    <Tag ref={containerRef as never} className={className} style={{ width: '100%', ...style }}>
      <span
        ref={textRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          fontSize: `${fontPx}px`,
          lineHeight: 'inherit',
          letterSpacing: 'inherit',
          fontFamily: 'inherit',
          fontWeight: 'inherit',
          color: 'inherit',
        }}
      >
        {children}
      </span>
    </Tag>
  );
}
