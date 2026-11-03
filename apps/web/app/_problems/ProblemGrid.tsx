"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "framer-motion";
import { TILES } from "./tiles";

export interface Problem {
  title: string;
  body: string;
}

// Tile tints and widths, in reading order. The fourth tile is the one dark contrast tile.
const LOOK = [
  { tone: "mint", wide: true },
  { tone: "butter", wide: false },
  { tone: "peach", wide: false },
  { tone: "ink", wide: false },
  { tone: "lilac", wide: false },
  { tone: "mint", wide: true },
];

const TURN_MS = 3000; // a new tile starts every 3s and a loop lasts ~6s, so at most two run at once

function usePageVisible() {
  return useSyncExternalStore(
    notify => {
      document.addEventListener("visibilitychange", notify);
      return () => document.removeEventListener("visibilitychange", notify);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}

export function ProblemGrid({ problems }: { problems: Problem[] }) {
  const reduced = useReducedMotion();
  const pageVisible = usePageVisible();
  const [inView, setInView] = useState<boolean[]>(() => problems.map(() => false));
  const [runs, setRuns] = useState<number[]>(() => problems.map(() => 0));
  const running = useRef<Set<number>>(new Set());
  const turn = useRef(0);
  const tiles = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      setInView(prev => {
        const next = [...prev];
        for (const e of entries) next[Number((e.target as HTMLElement).dataset.index)] = e.isIntersecting;
        return next;
      });
    });
    tiles.current.forEach(t => t && io.observe(t));
    return () => io.disconnect();
  }, []);

  const start = useCallback((i: number) => {
    running.current.add(i);
    setRuns(r => r.map((v, j) => (j === i ? v + 1 : v)));
  }, []);

  // The conductor: every TURN_MS, the next on-screen tile that isn't already playing gets a turn.
  useEffect(() => {
    if (reduced || !pageVisible) return;
    const tick = () => {
      for (let k = 0; k < problems.length; k++) {
        const i = (turn.current + k) % problems.length;
        if (inView[i] && !running.current.has(i)) {
          turn.current = i + 1;
          start(i);
          return;
        }
      }
    };
    const first = window.setTimeout(tick, 400);
    const every = window.setInterval(tick, TURN_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [reduced, pageVisible, inView, problems.length, start]);

  const done = useCallback((i: number) => running.current.delete(i), []);

  return (
    <div className="p-grid">
      {problems.map((p, i) => {
        const look = LOOK[i]!;
        return (
          <article
            key={p.title}
            ref={el => {
              tiles.current[i] = el;
            }}
            data-index={i}
            className={`p-tile p-${look.tone}${look.wide ? " p-wide" : ""}`}
            onMouseEnter={() => !reduced && start(i)}
          >
            {reduced ? (
              <StillStage index={i} />
            ) : (
              <LiveStage index={i} run={runs[i]!} active={inView[i]! && pageVisible} onDone={done} />
            )}
            <div className="p-text">
              <h3 className="p-title">{p.title}</h3>
              <p className="p-body">{p.body}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Plays one loop each time `run` changes, then rests on the fixed frame. */
function LiveStage({ index, run, active, onDone }: { index: number; run: number; active: boolean; onDone: (i: number) => void }) {
  const { steps, Frame } = TILES[index]!;
  const last = steps.length - 1;
  const [step, setStep] = useState(last);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (run === 0) return;
    setStep(0);
    setPlaying(true);
  }, [run]);

  useEffect(() => {
    if (!playing) return;
    if (!active) {
      // Off screen or tab hidden: settle on the fixed frame and give the turn back.
      setStep(last);
      setPlaying(false);
      onDone(index);
      return;
    }
    if (step >= last) {
      const t = window.setTimeout(() => {
        setPlaying(false);
        onDone(index);
      }, steps[last]);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setStep(s => s + 1), steps[step]);
    return () => window.clearTimeout(t);
  }, [playing, active, step, last, steps, index, onDone]);

  return (
    <div className="p-stage" aria-hidden="true">
      <Frame step={step} />
    </div>
  );
}

/** Reduced motion: the failure, greyed, above the fix. */
function StillStage({ index }: { index: number }) {
  const { steps, failStep, Frame } = TILES[index]!;
  return (
    <div className="p-stage-still" aria-hidden="true">
      <div className="p-still p-still-fail">
        <Frame step={failStep} />
      </div>
      <div className="p-still">
        <Frame step={steps.length - 1} />
      </div>
    </div>
  );
}
