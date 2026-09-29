// Adapted from wavesurfer.js 8.0.1, src/reactive/drag-stream.ts, which is internal to the package.
//
// Copyright (c) 2012-2023, katspaugh and contributors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// * Redistributions of source code must retain the above copyright notice, this
//   list of conditions and the following disclaimer.
//
// * Redistributions in binary form must reproduce the above copyright notice,
//   this list of conditions and the following disclaimer in the documentation
//   and/or other materials provided with the distribution.
//
// * Neither the name of the copyright holder nor the names of its
//   contributors may be used to endorse or promote products derived from
//   this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

export interface DragHandlers {
  onStart: (x: number, y: number) => void;
  onMove: (dx: number, dy: number, x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
}

export interface DragOptions {
  // The distance in pixels the pointer has to move before a drag starts.
  threshold?: number;
  mouseButton?: number;
  // On a touch screen, a drag waits this long in ms so that scrolling the page doesn't start one.
  touchDelay?: number;
}

/**
 * Call the handlers as the user drags the element, with positions relative to the element.
 * Returns a function that stops listening.
 */
export function listenForDrags(
  element: HTMLElement,
  handlers: DragHandlers,
  options: DragOptions = {},
): () => void {
  const { threshold = 3, mouseButton = 0, touchDelay = 100 } = options;
  const activePointers = new Map<number, PointerEvent>();
  const isTouchDevice = matchMedia("(pointer: coarse)").matches;
  let unsubscribeDocument = () => {};

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== mouseButton) return;
    if (activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, event);
    // A second finger doesn't start a drag of its own.
    if (activePointers.size > 1) return;

    const dragPointerId = event.pointerId;
    let startX = event.clientX;
    let startY = event.clientY;
    let isDragging = false;
    const touchStartTime = Date.now();
    const { left, top } = element.getBoundingClientRect();

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerId) return;
      if (event.defaultPrevented || activePointers.size > 1) return;
      if (isTouchDevice && Date.now() - touchStartTime < touchDelay) return;

      const x = event.clientX;
      const y = event.clientY;
      const dx = x - startX;
      const dy = y - startY;
      if (isDragging || Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        event.preventDefault();
        event.stopPropagation();
        if (!isDragging) {
          handlers.onStart(startX - left, startY - top);
          isDragging = true;
        }
        handlers.onMove(dx, dy, x - left, y - top);
        startX = x;
        startY = y;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!activePointers.delete(event.pointerId)) return;
      if (event.pointerId === dragPointerId && isDragging) {
        handlers.onEnd(event.clientX - left, event.clientY - top);
      }
      if (activePointers.size === 0) {
        unsubscribeDocument();
      }
    };

    // The click that ends a drag would otherwise also count as a click on what was dragged.
    const onClick = (event: MouseEvent) => {
      if (isDragging) {
        event.stopPropagation();
        event.preventDefault();
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.defaultPrevented || activePointers.size > 1) return;
      if (isDragging) {
        event.preventDefault();
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("click", onClick, { capture: true });

    unsubscribeDocument = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("touchmove", onTouchMove);
      // The click fires after pointerup, so its listener has to outlive the others.
      setTimeout(() => {
        document.removeEventListener("click", onClick, { capture: true });
      }, 10);
    };
  };

  element.addEventListener("pointerdown", onPointerDown);

  return () => {
    unsubscribeDocument();
    element.removeEventListener("pointerdown", onPointerDown);
    activePointers.clear();
  };
}
