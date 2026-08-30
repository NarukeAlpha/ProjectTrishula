import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const FRAME_INTERVAL_MS = 32;
const CATCH_UP_MS = 96;
const MAX_PENDING_GRAPHEMES = 2_048;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const WORD_SEGMENTER =
  "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;
const GRAPHEME_SEGMENTER =
  "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

interface SmoothTextSnapshot {
  text: string;
  revealStart: number;
  revision: number;
  sourceTarget: string;
  hasVisibleText: boolean;
}

function segmentWords(text: string): string[] {
  if (!text) return [];
  if (WORD_SEGMENTER) {
    const segments = WORD_SEGMENTER.segment(text);
    const words: string[] = [];
    let leading = "";
    for (const segment of segments) {
      if (segment.isWordLike) {
        words.push(leading + segment.segment);
        leading = "";
      } else if (words.length > 0) {
        words[words.length - 1] += segment.segment;
      } else {
        leading += segment.segment;
      }
    }
    if (leading) words.push(leading);
    return words;
  }
  return Array.from(text);
}

function countGraphemes(text: string): number {
  if (GRAPHEME_SEGMENTER)
    return Array.from(GRAPHEME_SEGMENTER.segment(text)).length;
  return Array.from(text).length;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
  );

  useLayoutEffect(() => {
    const media = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function useSmoothText(
  target: string,
  animate: boolean,
): SmoothTextSnapshot {
  const reducedMotion = useReducedMotion();
  const enabled = animate && !reducedMotion;
  const [snapshot, setSnapshot] = useState<SmoothTextSnapshot>({
    text: target,
    revealStart: target.length,
    revision: 0,
    sourceTarget: target,
    hasVisibleText: /\S/u.test(target),
  });
  const displayedRef = useRef(target);
  const targetRef = useRef(target);
  const previousTargetRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  const deadlineRef = useRef(0);
  const lastCommitRef = useRef(0);
  const revisionRef = useRef(0);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    deadlineRef.current = 0;
  }, []);

  const tick = useCallback(function reveal(now: number) {
    frameRef.current = null;
    const displayed = displayedRef.current;
    const latestTarget = targetRef.current;
    if (displayed === latestTarget) {
      deadlineRef.current = 0;
      return;
    }

    if (
      now < deadlineRef.current &&
      now - lastCommitRef.current < FRAME_INTERVAL_MS
    ) {
      frameRef.current = requestAnimationFrame(reveal);
      return;
    }

    if (now >= deadlineRef.current) {
      displayedRef.current = latestTarget;
      revisionRef.current += 1;
      setSnapshot({
        text: latestTarget,
        revealStart: displayed.length,
        revision: revisionRef.current,
        sourceTarget: latestTarget,
        hasVisibleText: /\S/u.test(latestTarget),
      });
      deadlineRef.current = 0;
      return;
    }

    const pending = latestTarget.slice(displayed.length);
    const units = segmentWords(pending);
    const framesLeft = Math.max(
      1,
      Math.ceil((deadlineRef.current - now) / FRAME_INTERVAL_MS),
    );
    const unitsToReveal = Math.max(1, Math.ceil(units.length / framesLeft));
    const next = displayed + units.slice(0, unitsToReveal).join("");
    displayedRef.current = next;
    revisionRef.current += 1;
    setSnapshot({
      text: next,
      revealStart: displayed.length,
      revision: revisionRef.current,
      sourceTarget: latestTarget,
      hasVisibleText: /\S/u.test(next),
    });
    lastCommitRef.current = now;

    if (next !== latestTarget) frameRef.current = requestAnimationFrame(reveal);
    else deadlineRef.current = 0;
  }, []);

  useEffect(() => {
    const previousTarget = previousTargetRef.current;
    previousTargetRef.current = target;
    targetRef.current = target;

    const appendOnly =
      target.startsWith(previousTarget) &&
      target.startsWith(displayedRef.current);
    const firstVisibleText = !snapshot.hasVisibleText && /\S/u.test(target);
    const pendingIsTooLarge =
      appendOnly &&
      countGraphemes(target.slice(displayedRef.current.length)) >
        MAX_PENDING_GRAPHEMES;

    if (!enabled || !appendOnly || firstVisibleText || pendingIsTooLarge) {
      cancelFrame();
      displayedRef.current = target;
      revisionRef.current += 1;
      setSnapshot({
        text: target,
        revealStart: 0,
        revision: revisionRef.current,
        sourceTarget: target,
        hasVisibleText: /\S/u.test(target),
      });
      return;
    }

    setSnapshot((current) =>
      current.sourceTarget === target
        ? current
        : { ...current, sourceTarget: target },
    );
    if (displayedRef.current === target || frameRef.current !== null) return;
    const now = performance.now();
    deadlineRef.current = now + CATCH_UP_MS;
    lastCommitRef.current = now - FRAME_INTERVAL_MS;
    frameRef.current = requestAnimationFrame(tick);
  }, [cancelFrame, enabled, snapshot.hasVisibleText, target, tick]);

  useEffect(() => cancelFrame, [cancelFrame]);

  const firstVisibleText = !snapshot.hasVisibleText && /\S/u.test(target);
  const appendOnlyForThisRender =
    target.startsWith(snapshot.sourceTarget) &&
    target.startsWith(snapshot.text);
  const pendingIsTooLarge =
    appendOnlyForThisRender &&
    countGraphemes(target.slice(snapshot.text.length)) > MAX_PENDING_GRAPHEMES;
  if (
    !enabled ||
    firstVisibleText ||
    !appendOnlyForThisRender ||
    pendingIsTooLarge
  ) {
    return {
      text: target,
      revealStart: 0,
      revision: snapshot.revision,
      sourceTarget: target,
      hasVisibleText: /\S/u.test(target),
    };
  }
  return snapshot;
}
