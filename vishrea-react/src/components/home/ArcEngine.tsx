import React, { useRef, useCallback, useEffect } from 'react';
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
  autoPlayInterval = 4000,
}: ArcEngineProps<T>) {
  const prefersReduced = useReducedMotion();
  const total = items.length;

  // Swipe / Drag handling
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const isInteractingRef = useRef<boolean>(false);
  const resumeTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  // Auto-scroll every autoPlayInterval ms (defaults to 4 seconds)
  useEffect(() => {
    if (!autoPlayInterval || autoPlayInterval <= 0 || prefersReduced || total <= 1) return;

    const intervalId = setInterval(() => {
      if (!isInteractingRef.current && !isDraggingRef.current) {
        goNext();
      }
    }, autoPlayInterval);

    return () => clearInterval(intervalId);
  }, [autoPlayInterval, prefersReduced, total, goNext]);

  const pauseInteraction = () => {
    isInteractingRef.current = true;
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const resumeInteractionLater = (delayMs = 3500) => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      isInteractingRef.current = false;
    }, delayMs);
  };

  // Drag start
  const handleDragStart = (clientX: number, clientY: number) => {
    pauseInteraction();
    startXRef.current = clientX;
    startYRef.current = clientY;
    isDraggingRef.current = false;
  };

  // Drag move
  const handleDragMove = (clientX: number, clientY: number) => {
    if (startXRef.current === null) return;
    const diffX = clientX - startXRef.current;
    const diffY = clientY - (startYRef.current ?? clientY);

    if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
      isDraggingRef.current = true;
    }
  };

  // Drag end / Swipe trigger
  const handleDragEnd = (clientX: number) => {
    if (startXRef.current !== null) {
      const diffX = clientX - startXRef.current;
      if (Math.abs(diffX) > 35) {
        if (diffX > 0) {
          goPrev();
        } else {
          goNext();
        }
      }
    }
    startXRef.current = null;
    startYRef.current = null;
    setTimeout(() => {
      isDraggingRef.current = false;
      resumeInteractionLater(4000);
    }, 60);
  };

  // Pointer drag listeners (desktop mouse & pointer)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    handleDragStart(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    handleDragMove(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    handleDragEnd(e.clientX);
  };

  const handlePointerCancel = () => {
    startXRef.current = null;
    startYRef.current = null;
    isDraggingRef.current = false;
    resumeInteractionLater(1000);
  };

  // Native touch listeners for mobile finger drag
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.changedTouches.length > 0) {
      handleDragEnd(e.changedTouches[0].clientX);
    } else {
      handlePointerCancel();
    }
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
      onPointerCancel={handlePointerCancel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handlePointerCancel}
      onMouseEnter={pauseInteraction}
      onMouseLeave={() => resumeInteractionLater(1500)}
      className={`vishrea-arc-stage ${className}`}
      style={{
        height: typeof stageHeight === 'number' ? `${stageHeight}px` : stageHeight,
        perspective: '1400px',
        touchAction: 'pan-y',
        userSelect: 'none',
        WebkitUserSelect: 'none',
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
