import { useEffect, useRef, useState } from 'react';
import { isCompactPlanningWidth } from './planningLayout.mjs';

export default function usePlanningLayout() {
  const containerRef = useRef(null);
  // Cards are safe until the actual content box has been measured.
  const [contentWidth, setContentWidth] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => setContentWidth(entry.contentRect.width));
      observer.observe(element);
      return () => observer.disconnect();
    }
    const measure = () => {
      const style = getComputedStyle(element);
      setContentWidth(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return { containerRef, useCompactPlanningList: isCompactPlanningWidth(contentWidth) };
}
