"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { SCENE_COUNT, STAGE_ID } from "./Stage";

export const FEATURES = [
  { title: "Pay from any chain", body: "Buyers pay from any of 30+ chains, or from several at once." },
  { title: "Exact amount, every time", body: "Merchants always receive what they invoiced." },
  { title: "Holds and refunds", body: "Hold until you deliver; refund to the original chain." },
  { title: "Splits", body: "Share revenue with co-hosts and venues automatically." },
];
const ITEMS = [...FEATURES.map((f, i) => ({ ...f, num: String(i + 1).padStart(2, "0") })), { title: "All together", body: "", num: "" }];

const ROW = 48; // a collapsed row: the title
const OPEN = 34; // extra height of the active row: description and progress line

export const tabId = (i: number) => `feature-tab-${i}`;

/**
 * Vertical tabs over the stage's scenes, advancing on their own every 6s. Arrow keys move
 * focus, Enter or Space selects. Rows are absolutely positioned and slide with transforms, so
 * opening one never shifts layout. The tour pauses only for the Pause button, keyboard focus
 * inside the list, or when `running` is false (off screen, tab hidden).
 */
export function FeatureList({
  selected,
  onSelect,
  running,
  autoplayDefault = true,
}: {
  selected: number;
  onSelect: (i: number) => void;
  running: boolean;
  autoplayDefault?: boolean;
}) {
  const [playing, setPlaying] = useState(autoplayDefault);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const advancing = playing && running;
  const count = SCENE_COUNT;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = tabs.current.findIndex(t => t === document.activeElement);
    if (current < 0) return;
    const next =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? (current + 1) % count
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? (current - 1 + count) % count
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? count - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    tabs.current[next]?.focus();
  };

  return (
    <div className="features">
      <div
        className="features-list"
        role="tablist"
        aria-orientation="vertical"
        aria-label="What Morva does"
        onKeyDown={onKeyDown}
        style={{ height: ITEMS.length * ROW + OPEN }}
      >
        {ITEMS.map((item, i) => {
          const on = i === selected;
          return (
            <motion.div
              key={item.title}
              className={`feature${on ? " feature-on" : ""}`}
              initial={false}
              animate={{ y: i * ROW + (i > selected ? OPEN : 0) }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                ref={el => {
                  tabs.current[i] = el;
                }}
                id={tabId(i)}
                role="tab"
                aria-selected={on}
                aria-controls={STAGE_ID}
                tabIndex={on ? 0 : -1}
                className="feature-tab"
                style={{ height: ROW }}
                onClick={() => onSelect(i)}
              >
                <span className="feature-num">{item.num}</span>
                <span className="feature-title">{item.title}</span>
              </button>
              <motion.div
                className="feature-open"
                style={{ height: OPEN }}
                initial={false}
                animate={{ opacity: on ? 1 : 0 }}
                transition={{ duration: 0.3, delay: on ? 0.15 : 0 }}
                aria-hidden={!on}
              >
                {item.body && <span className="feature-body">{item.body}</span>}
                <span className="feature-track">
                  {on && (
                    <span
                      key={selected}
                      className="feature-progress"
                      style={{ animationPlayState: advancing ? undefined : "paused" }}
                      onAnimationEnd={() => onSelect((selected + 1) % count)}
                    />
                  )}
                </span>
              </motion.div>
            </motion.div>
          );
        })}
      </div>
      <button
        type="button"
        className="features-toggle"
        aria-label={playing ? "Pause the feature tour" : "Play the feature tour"}
        onClick={() => setPlaying(p => !p)}
      >
        {playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
        {playing ? "Pause" : "Play"}
      </button>
    </div>
  );
}

