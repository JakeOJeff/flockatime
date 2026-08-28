import { useEffect, useRef, useState } from 'react';

/**
 * Measures a container so SVG charts can lay out in real pixels rather than
 * being stretched by preserveAspectRatio, which would distort the text.
 */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}
