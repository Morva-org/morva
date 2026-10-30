"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { SCENES } from "./screens";

// "One total, paid from wherever the money is.": a phone that plays a buyer paying from three
// chains and the merchant receiving it, with a payment log beside it that writes itself in sync.

const PHONE_W = 380;
const PHONE_H = 780;
const END_HOLD = 2000;

const PHONE_LABEL =
  "Simulated phone demo: a buyer opens a payment link from a chat, sees $27.50 across three chains, approves the moves, " +
  "signs once to pay $25.00, and gets a ticket. The merchant then receives exactly 25.00 USDC.";

interface Cue {
  scene: number;
  sub: number;
  start: number;
  dur: number;
}

// The whole loop as a flat list of cues.
const CUES: Cue[] = [];
{
  let t = 0;
  SCENES.forEach((s, scene) =>
    s.subs.forEach((dur, sub) => {
      CUES.push({ scene, sub, start: t, dur });
      t += dur;
    }),
  );
}
const LOOP = CUES[CUES.length - 1]!.start + CUES[CUES.length - 1]!.dur + END_HOLD;
const cueOf = (scene: number, sub: number) => CUES.find(c => c.scene === scene && c.sub === sub)!;

function cueAt(t: number): Cue {
  for (let i = CUES.length - 1; i >= 0; i--) if (t >= CUES[i]!.start) return CUES[i]!;
  return CUES[0]!;
}

/**
 * The log. `at` is the phone moment that writes the line; `still` is the phone screen it shows
 * under reduced motion. Elapsed seconds are illustrative: the spike has no end-to-end timings.
 */
const LINES = [
  { secs: 0, event: "Link opened", detail: "pay.morva.xyz", at: cueOf(1, 0), still: cueOf(0, 3) },
  { secs: 2, event: "Found $27.50 across 3 chains", detail: "Base · Arbitrum · Optimism", at: cueOf(1, 1), still: cueOf(1, 3) },
  { secs: 2, event: "Skipped $0.30 on Polygon", detail: "too small to move", at: cueOf(1, 2), still: cueOf(1, 3) },
  { secs: 5, event: "Moves approved", detail: "3 transfers", at: cueOf(2, 2), still: cueOf(2, 3) },
  { secs: 18, event: "Received in your balance", detail: "$25.25", at: cueOf(2, 4), still: cueOf(2, 5) },
  { secs: 19, event: "Signed once", detail: "Pay $25.00", at: cueOf(3, 2), still: cueOf(3, 3) },
  { secs: 20, event: "Northside Events received", detail: "25.00 USDC", at: cueOf(5, 1), still: cueOf(5, 3) },
];
const LAST = LINES.length - 1;

/** Illustrative elapsed seconds at phone time t: steps between lines, easing up to each one. */
function clockSecs(t: number): number {
  for (let i = LINES.length - 1; i >= 0; i--) {
    const line = LINES[i]!;
    if (t >= line.at.start) {
      const next = LINES[i + 1];
      if (!next || next.secs === line.secs) return line.secs;
      const span = next.at.start - line.at.start;
      return line.secs + ((next.secs - line.secs) * (t - line.at.start)) / span;
    }
  }
  return 0;
}
const fmt = (secs: number) => `0:${String(Math.floor(secs)).padStart(2, "0")}`;

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

export function CheckoutStory({ head, paragraph }: { head: React.ReactNode; paragraph: React.ReactNode }) {
  const reduced = useReducedMotion();
  const pageVisible = usePageVisible();
  const root = useRef<HTMLDivElement>(null);
  const phoneBox = useRef<HTMLDivElement>(null);

  const [inView, setInView] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [cue, setCue] = useState<Cue>(CUES[0]!);
  const elapsed = useRef(0);
  const clock = useMotionValue(0);
  const clockText = useTransform(clock, fmt);

  const autoplay = !reduced;
  const playing = autoplay && !userPaused && !hovering && !keyboardFocus && inView && pageVisible;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e?.isIntersecting ?? false), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const seek = useCallback(
    (t: number) => {
      elapsed.current = t;
      const c = cueAt(t);
      setCue(prev => (prev === c ? prev : c));
      clock.set(clockSecs(t));
    },
    [clock],
  );

  // One clock for the phone and the log. React state changes only when a cue changes.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      seek((elapsed.current + now - last) % LOOP);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, seek]);

  // Reduced motion: no autoplay; the full log shows and the phone starts on the link.
  useEffect(() => {
    if (reduced) {
      seek(LINES[0]!.still.start);
      clock.set(LINES[LAST]!.secs);
    }
  }, [reduced, seek, clock]);

  const jump = (i: number) => {
    const line = LINES[i]!;
    seek(reduced ? line.still.start : line.at.start + 1);
    if (reduced) clock.set(LINES[LAST]!.secs);
    else setUserPaused(true);
  };
  const replay = () => {
    seek(0);
    setUserPaused(false);
  };

  // Lines written so far. Under reduced motion the whole log is always shown.
  const written = reduced ? LINES.length : LINES.filter(l => elapsed.current >= l.at.start).length;
  const newest = written - 1;
  const merchantSide = !reduced && SCENES[cue.scene]!.view === "Merchant view";

  // Phone scale: fit the column's width and, on wide screens, the viewport's height.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = phoneBox.current;
    if (!el) return;
    const fit = () => {
      const byWidth = el.clientWidth / PHONE_W;
      const byHeight = window.innerWidth >= 960 ? (window.innerHeight - 120) / (PHONE_H + 40) : Infinity;
      setScale(Math.max(0.55, Math.min(1, byWidth, byHeight)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  const scene = SCENES[cue.scene]!;
  const tap = scene.taps?.[cue.sub];
  const Screen = scene.Screen;
  const paused = autoplay && !playing && inView;

  return (
    <div ref={root} className="story2">
      <div className="story2-head">
        {head}
        {paragraph}
      </div>

      <div
        ref={phoneBox}
        className="story-right story2-phone"
        role="img"
        aria-label={PHONE_LABEL}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div className="story-labels" aria-hidden="true">
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={scene.view}
              className="story-view"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
            >
              {scene.view}
            </motion.span>
          </AnimatePresence>
          <span className="tag">Simulated</span>
        </div>
        <div className="phone-fit" style={{ height: PHONE_H * scale }}>
          <div className="phone" style={{ transform: `scale(${scale})` }} aria-hidden="true">
            <div className="phone-screen">
              <StatusBar />
              <div className="phone-body">
                <AnimatePresence initial={false}>
                  <motion.div
                    key={cue.scene}
                    className="phone-scene"
                    initial={cue.scene === 1 ? { y: 736 } : { opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: cue.scene === 1 ? 0.55 : 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Screen sub={cue.sub} />
                  </motion.div>
                </AnimatePresence>
                <AnimatePresence>
                  {tap && !reduced && (
                    <motion.span
                      key={`${cue.scene}-${cue.sub}`}
                      className="phone-tap"
                      style={{ left: tap[0] - 22, top: tap[1] - 22 }}
                      initial={{ opacity: 0, scale: 1.4 }}
                      animate={{ opacity: [0, 0.9, 0.9, 0], scale: [1.4, 1, 0.85, 1] }}
                      transition={{ duration: 0.75, times: [0, 0.35, 0.6, 1] }}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="story2-log"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={e => setKeyboardFocus(e.target.matches(":focus-visible"))}
        onBlur={() => setKeyboardFocus(false)}
      >
        <div className="log-clock-row">
          <motion.span className="log-clock" aria-hidden="true">
            {clockText}
          </motion.span>
          <span className="log-clock-note">elapsed, illustrative</span>
          {paused && (
            <button type="button" className="log-replay" onClick={replay}>
              Replay
            </button>
          )}
        </div>

        <ol className="log" aria-label="Payment log" aria-live="off">
          <AnimatePresence initial={false}>
            {LINES.slice(0, written).map((line, i) => (
              <motion.li
                key={line.event}
                className={`log-line${i === newest ? " log-new" : ""}${i === LAST ? " log-final" : ""}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.25, delay: i * 0.08 } }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {i === LAST && (
                  <motion.span className="log-side" initial={{ opacity: 0 }} animate={{ opacity: merchantSide || reduced ? 1 : 0.6 }}>
                    Merchant
                  </motion.span>
                )}
                <button type="button" className="log-button" onClick={() => jump(i)}>
                  <span className="log-time">{fmt(line.secs)}</span>
                  <span className="log-event">
                    {line.event}
                    {/* A canvas-coloured cover slides off the text: a visual reveal only. */}
                    {!reduced && (
                      <motion.span
                        className="log-cover"
                        aria-hidden="true"
                        initial={{ scaleX: 1 }}
                        animate={{ scaleX: 0 }}
                        transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
                      />
                    )}
                  </span>
                  <span className="log-detail">{line.detail}</span>
                </button>
                {i === LAST && (
                  <motion.span
                    className="log-rule"
                    aria-hidden="true"
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
                  />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        <p className="story-note">No wallet? A one-time deposit address works from any exchange.</p>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="phone-status">
      <span className="num">9:41</span>
      <span className="phone-island" />
      <span className="phone-icons">
        <svg width={18} height={12} viewBox="0 0 18 12" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <rect key={i} x={i * 5} y={9 - i * 3} width={3} height={3 + i * 3} rx={1} fill="currentColor" />
          ))}
        </svg>
        <svg width={26} height={12} viewBox="0 0 26 12" aria-hidden="true">
          <rect x={0.5} y={0.5} width={22} height={11} rx={3} fill="none" stroke="currentColor" />
          <rect x={2.5} y={2.5} width={15} height={7} rx={1.5} fill="currentColor" />
          <rect x={23.5} y={4} width={2} height={4} rx={1} fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}
