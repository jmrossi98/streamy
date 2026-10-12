"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { nearestFrame, prewarmTimes, PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./seekHoverRules";

/** Frames kept per title. 160x90 each, so a few megabytes at most. */
const MAX_FRAMES = 300;

/**
 * The picture shown while pointing at the seek bar.
 *
 * A second, muted <video> on the title's own file that is only ever seeked.
 * The first version showed that element directly, so every hover waited for
 * its own seek: an index lookup and a cluster fetch through the proxy, most
 * of a second each, with a blank box in between.
 *
 * Now every frame that arrives is copied to a small canvas and kept, and the
 * box always shows the nearest frame already held while the exact one loads:
 *
 *   - the file is opened when the player mounts, not on the first hover, so
 *     its headers and index are already in by the time anyone points at the
 *     bar;
 *   - the first hover starts filling in a coarse set of frames across the
 *     whole title, so a sweep of the bar has something close to show
 *     everywhere within a few seconds;
 *   - a position seen once is instant from then on.
 *
 * One seek at a time; what the pointer is on always goes ahead of the
 * background fill.
 */
export function useSeekPreview(
  src: string | null | undefined,
  duration: number
): {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  /** The file cannot be decoded here; show the time alone. */
  failed: boolean;
  /** A frame is on the canvas. */
  hasFrame: boolean;
  /** Call with the pointed-at time, or null when the pointer leaves. */
  point: (seconds: number | null) => void;
  onError: () => void;
} {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frames = useRef(new Map<number, HTMLCanvasElement>());
  const pointed = useRef<number | null>(null);
  const backlog = useRef<number[]>([]);
  const seekingFor = useRef<number | null>(null);
  const filled = useRef(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);

  const show = useCallback((t: number) => {
    const canvas = canvasRef.current;
    const at = nearestFrame([...frames.current.keys()], t);
    if (!canvas || at == null) return;
    const frame = frames.current.get(at);
    const ctx = canvas.getContext("2d");
    if (!frame || !ctx) return;
    ctx.drawImage(frame, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    setFrameSrc(src ?? null);
  }, [src]);

  const next = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 1 || seekingFor.current != null) return;
    let t: number | undefined;
    const want = pointed.current;
    if (want != null && !frames.current.has(want)) t = want;
    else {
      while (backlog.current.length > 0 && t === undefined) {
        const candidate = backlog.current.shift()!;
        if (!frames.current.has(candidate)) t = candidate;
      }
    }
    if (t === undefined) return;
    seekingFor.current = t;
    try {
      v.currentTime = t;
    } catch {
      seekingFor.current = null;
    }
  }, []);

  // A different title: forget everything held for the last one.
  useEffect(() => {
    frames.current = new Map();
    backlog.current = [];
    seekingFor.current = null;
    filled.current = false;
  }, [src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    const landed = () => {
      const t = seekingFor.current;
      seekingFor.current = null;
      if (t != null && v.videoWidth > 0) {
        const frame = document.createElement("canvas");
        frame.width = PREVIEW_WIDTH;
        frame.height = PREVIEW_HEIGHT;
        const ctx = frame.getContext("2d");
        if (ctx) {
          // Letterboxed, so a 4:3 episode is not stretched.
          const scale = Math.min(PREVIEW_WIDTH / v.videoWidth, PREVIEW_HEIGHT / v.videoHeight);
          const w = v.videoWidth * scale;
          const h = v.videoHeight * scale;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
          try {
            ctx.drawImage(v, (PREVIEW_WIDTH - w) / 2, (PREVIEW_HEIGHT - h) / 2, w, h);
            if (frames.current.size >= MAX_FRAMES) {
              const oldest = frames.current.keys().next().value;
              if (oldest !== undefined) frames.current.delete(oldest);
            }
            frames.current.set(t, frame);
          } catch {
            /* a frame that cannot be copied is simply not kept */
          }
        }
        if (pointed.current != null) show(pointed.current);
      }
      next();
    };
    v.addEventListener("seeked", landed);
    v.addEventListener("loadedmetadata", next);
    return () => {
      v.removeEventListener("seeked", landed);
      v.removeEventListener("loadedmetadata", next);
      // Let go of the file when the player closes or the title changes.
      v.removeAttribute("src");
      v.load();
    };
  }, [src, next, show]);

  const point = useCallback(
    (seconds: number | null) => {
      pointed.current = seconds;
      if (seconds == null) return;
      if (!filled.current && duration > 0) {
        filled.current = true;
        backlog.current = prewarmTimes(duration);
      }
      show(seconds);
      next();
    },
    [duration, show, next]
  );

  const onError = useCallback(() => setFailedSrc(src ?? null), [src]);

  return {
    videoRef,
    canvasRef,
    failed: !!src && failedSrc === src,
    hasFrame: !!src && frameSrc === src,
    point,
    onError,
  };
}
