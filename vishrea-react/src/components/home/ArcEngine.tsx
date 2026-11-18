import React, { useRef, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ArcEngineProps } from './types';

const EASING: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function ArcEngine<T>({
  items,
  activeIndex,
  onChange,
  renderItem,
  gap = 260,
  lift = 0,
  rot = 0,
  fade = 0.25,
  blur = true,
  centreScale = 1.05,
  stageHeight = 520,
  className = '',
  onItemClick,
  ariaLabel = 'Interactive carousel',
}: ArcEngineProps<T>) {
  const prefersReduced = useReducedMotion();
  const total = items.length;

  // Swipe / Drag handling
  const startXRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (nextIdx: number) => {
      if (total === 0) return;
      const normalized = ((nextIdx % total) + total) % total;
      onChange(normalized);
    },
    [total, onChange]
  );

  const goPrev = useCallback(() => go(activeIndex - 1), [go, activeIndex]);
  const goNext = useCallback(() => go(activeIndex + 1), [go, activeIndex]);

  // Pointer drag listeners
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only primary button
    if (e.button !== 0) return;
    startXRef.current = e.clientX;
    isDraggingRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (startXRef.current !== null) {
      if (Math.abs(e.clientX - startXRef.current) > 8) {
        isDraggingRef.current = true;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startXRef.current !== null) {
      const diff = e.clientX - startXRef.current;
      if (Math.abs(diff) > 40) {
        if (diff > 0) {
          goPrev();
        } else {
          goNext();
        }
      }
    }
    startXRef.current = null;
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    }
  };

  return (
    <div
      ref={stageRef}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        startXRef.current = null;
        isDraggingRef.current = false;
      }}
      className={`vishrea-arc-stage ${className}`}
      style={{
        height: typeof stageHeight === 'number' ? `${stageHeight}px` : stageHeight,
        perspective: '1400px',
      }}
    >
      {items.map((item, k) => {
        // Wrap-around distance d relative to active
        let d = k - activeIndex;
        if (total > 0) {
          if (d > total / 2) d -= total;
          if (d < -total / 2) d += total;
        }
        const absD = Math.abs(d);
        const isActive = d === 0;
        const isSide = !isActive;

        // Skip cards that are beyond visible bounds to optimize performance
        const isVisible = absD <= 3.5;

        // Mathematical transforms matching specification:
        // translateX(d * gap) translateY(d * d * lift) rotate(d * rot)
        // scale(1 - min(|d|, 3) * 0.07); centre card scale 1.05
        const targetX = prefersReduced ? 0 : d * gap;
        const targetY = prefersReduced ? 0 : d * d * lift;
        const targetRotate = prefersReduced ? 0 : d * rot;
        const targetScale = prefersReduced
          ? isActive
            ? 1
            : 0.95
          : isActive
          ? centreScale
          : Math.max(0.7, 1 - Math.min(absD, 3) * 0.07);

        // Opacity falls with |d|
        const targetOpacity = prefersReduced
          ? isActive
            ? 1
            : 0.15
          : Math.max(0, 1 - absD * fade);

        // Blur: centre sharp, sides blurred up to 6px
        const blurMultiplier = typeof blur === 'number' ? blur : 2;
        const blurPx = blur && !prefersReduced ? (isActive ? 0 : Math.min(absD, 3) * blurMultiplier) : 0;
        const filterStr = blurPx > 0 ? `blur(${blurPx}px)` : 'none';

        const zIndex = 50 - Math.round(absD);

        return (
          <motion.div
            key={k}
            className="vishrea-arc-card"
            initial={false}
            animate={{
              x: `calc(-50% + ${targetX}px)`,
              y: `calc(-50% + ${targetY}px)`,
              rotateZ: targetRotate,
              scale: targetScale,
              opacity: isVisible ? targetOpacity : 0,
              filter: filterStr,
            }}
            transition={{
              duration: prefersReduced ? 0.01 : 0.7,
              ease: EASING,
            }}
            style={{
              zIndex,
              pointerEvents: absD > 3 ? 'none' : 'auto',
            }}
            onClick={(e) => {
              if (isDraggingRef.current) return;
              if (isSide) {
                e.stopPropagation();
                go(k);
              } else {
                onItemClick?.(item, k);
              }
            }}
            aria-hidden={!isActive}
          >
            {renderItem(item, k, { d, absD, isActive, isSide })}
          </motion.div>
        );
      })}
    </div>
  );
}
