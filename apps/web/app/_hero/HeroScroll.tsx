"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  transform,
  type MotionValue,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import { MorvaMark } from "../MorvaMark";
import { computeLayout } from "./geometry";
import { RoutingDiagram, type DiagramMode } from "./RoutingDiagram";
import { Stage, STAGE_ID, SCENE_NAMES } from "./Stage";
import { FeatureList } from "./FeatureList";

const CTA_HREF = "#checkout";
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useMediaQuery(query: string, serverValue: boolean) {
  return useSyncExternalStore(
    notify => {
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

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

function useInView(ref: React.RefObject<Element | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

/** Tracks an element's width with ResizeObserver; never read inside scroll handlers. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Maps a scroll range with a function transform. framer-motion hands plain range transforms
 * of scroll progress to native ViewTimeline animations, whose range doesn't match this
 * container's offsets; past the end they finish and snap back. A function keeps it on the JS path.
 */
function useRange(p: MotionValue<number>, input: number[], output: number[]) {
  return useTransform(p, v => transform(v, input, output));
}

function HeroCopy({ style, inert }: { style?: React.ComponentProps<typeof motion.div>["style"]; inert?: boolean }) {
  return (
    <motion.div className="hero2-copy" style={style} inert={inert}>
      <h1 className="hero2-title">Every wallet. Every chain. One way to get paid.</h1>
      <p className="hero2-sub">
        Morva lets any business get paid by anyone holding crypto, from any wallet, on any chain, in the currency the
        business wants.
      </p>
      <a href={CTA_HREF} className="btn">
        Try the checkout <ArrowRight size={18} strokeWidth={1.5} />
      </a>
    </motion.div>
  );
}

function SectionHeading() {
  return (
    <h2 className="c-title">
      <span>One balance. Every chain.</span> <span>Everything after the payment.</span>
    </h2>
  );
}

function SectionLead() {
  return (
    <p className="c-lead">
      The buyer pays with whatever they hold, on whichever chain it sits. The business gets exactly what it asked for,
      and everything after: holds, refunds to source, and splits.
    </p>
  );
}

/** Reduced-motion stage: the exported key frames, cross-faded on selection. */
function SceneImage({ scene }: { scene: number }) {
  return (
    <div className="stage stage-image" id={STAGE_ID} role="tabpanel" aria-label={`Example: ${SCENE_NAMES[scene]}`}>
      <AnimatePresence initial={false}>
        <motion.img
          key={scene}
          src={`/section/scene-${scene + 1}.png`}
          alt=""
          width={1280}
          height={1080}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        />
      </AnimatePresence>
    </div>
  );
}

export function HeroScroll() {
  const reduced = useReducedMotion();
  return reduced ? <StaticHero /> : <ScrollHero />;
}

/** Reduced motion: no loop, no zoom. Scene 1 drawn in full, then Section C with a fade. */
function StaticHero() {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const layout = useMemo(() => (width ? computeLayout(width) : null), [width]);
  const [feature, setFeature] = useState(0);
  const cRef = useRef<HTMLDivElement>(null);
  const cInView = useInView(cRef);

  return (
    <>
      <section className="hero2-static">
        <div className="container">
          <HeroCopy />
          <div ref={box} className="hero2-diagram-box">
            {layout && <RoutingDiagram layout={layout} mode="static" />}
          </div>
        </div>
      </section>
      <motion.section
        ref={cRef}
        className="section c-static c-zone c-dots-bg"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.4 }}
      >
        <div className="container c-inner">
          <SectionHeading />
          <div className="c-grid">
            <div className="c-left">
              <SectionLead />
              <FeatureList selected={feature} onSelect={setFeature} running={cInView} autoplayDefault={false} />
            </div>
            <div className="c-right">
              <SceneImage scene={feature} />
            </div>
          </div>
        </div>
      </motion.section>
    </>
  );
}

function ScrollHero() {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const diagramBox = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery("(min-width: 1200px)", true);
  const visible = usePageVisible();
  const diagramInView = useInView(diagramBox);
  const frameInView = useInView(frame);
  const [feature, setFeature] = useState(0);

  const width = useWidth(diagramBox);
  const layout = useMemo(() => (width ? computeLayout(width) : null), [width]);

  // Measured on resize only. Motion values carry them into the scroll transforms.
  const scaleTarget = useMotionValue(12);
  const panelDx = useMotionValue(0);
  const panelDy = useMotionValue(0);
  const [hubPoint, setHubPoint] = useState<{ x: number; y: number } | null>(null);

  useIsoLayoutEffect(() => {
    const f = frame.current;
    const d = diagramBox.current;
    const s = slot.current;
    if (!f || !d || !s || !layout) return;
    const measure = () => {
      // None of these elements carry a transform, so their boxes are layout boxes.
      const fr = f.getBoundingClientRect();
      const dr = d.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      const hub = layout.boxes.hub;
      const x = dr.left - fr.left + hub.x + hub.w / 2;
      const y = dr.top - fr.top + hub.y + hub.h / 2;
      setHubPoint({ x, y });
      scaleTarget.set(1.08 * Math.max((2 * Math.max(x, fr.width - x)) / hub.w, (2 * Math.max(y, fr.height - y)) / hub.h));
      panelDx.set(fr.width / 2 - (sr.left - fr.left + sr.width / 2));
      panelDy.set(fr.height / 2 - (sr.top - fr.top + sr.height / 2));
    };
    measure();
    const ro = new ResizeObserver(measure);
    [f, d, s].forEach(el => ro.observe(el));
    return () => ro.disconnect();
  }, [layout, wide, scaleTarget, panelDx, panelDy]);

  const { scrollYProgress: p } = useScroll({ target: container, offset: ["start start", "end end"] });

  const copyOpacity = useRange(p, [0, 0.2], [1, 0]);
  const copyY = useRange(p, [0, 0.2], [0, -40]);
  // Geometric interpolation reads as a steady push-in rather than a sudden one.
  const camScale = useTransform([p, scaleTarget] as MotionValue<number>[], ([v, s]: number[]) => {
    const t = Math.min(1, Math.max(0, (v! - 0.15) / 0.55));
    return Math.pow(s!, t * t * (3 - 2 * t));
  });
  const othersOpacity = useRange(p, [0.15, 0.45], [1, 0]);
  const hubContentOpacity = useRange(p, [0.14, 0.16], [1, 0]);
  const markOpacity = useRange(p, [0.14, 0.16, 0.6, 0.72], [0, 1, 1, 0]);
  const markScale = useRange(p, [0.15, 0.62], [1, 2.4]);
  const stageOpacity = useRange(p, [0.8, 0.9], [1, 0]);
  const panelOpacity = useRange(p, [0.6, 0.78], [0, 1]);
  const settle = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - 0.8) / 0.2));
    return 1 - (1 - t) * (1 - t) * (1 - t);
  };
  const panelX = useTransform([p, panelDx] as MotionValue<number>[], ([v, d]: number[]) => d! * (1 - settle(v!)));
  const panelY = useTransform([p, panelDy] as MotionValue<number>[], ([v, d]: number[]) => d! * (1 - settle(v!)));
  const cOpacity = useRange(p, [0.8, 0.9], [0, 1]);
  const cY = useRange(p, [0.8, 0.9], [16, 0]);

  // Discrete phases, set only when a threshold is crossed.
  const [phase, setPhase] = useState({ zooming: false, copyGone: false, cReady: false });
  useMotionValueEvent(p, "change", v => {
    const next = { zooming: v > 0.12, copyGone: v > 0.18, cReady: v > 0.84 };
    setPhase(prev =>
      prev.zooming === next.zooming && prev.copyGone === next.copyGone && prev.cReady === next.cReady ? prev : next,
    );
  });

  const mode: DiagramMode = phase.zooming ? "idle" : "loop";
  const list = <FeatureList selected={feature} onSelect={setFeature} running={phase.cReady && visible && frameInView} />;

  return (
    <>
      <div ref={container} className="hero2-scroll">
        <div ref={frame} className="hero2-frame">
          <motion.div className="hero2-stage" style={{ opacity: stageOpacity }}>
            <div className="container hero2-stage-inner">
              <HeroCopy style={{ opacity: copyOpacity, y: copyY }} inert={phase.copyGone} />
              <div ref={diagramBox} className="hero2-diagram-box">
                {layout && (
                  <motion.div
                    className="hero2-camera"
                    style={{
                      scale: camScale,
                      transformOrigin: `${layout.boxes.hub.x + layout.boxes.hub.w / 2}px ${layout.boxes.hub.y + layout.boxes.hub.h / 2}px`,
                    }}
                  >
                    <RoutingDiagram
                      layout={layout}
                      mode={mode}
                      playing={visible && diagramInView}
                      othersOpacity={othersOpacity}
                      hubContentOpacity={hubContentOpacity}
                    />
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>

          {hubPoint && (
            <motion.div
              className="hero2-hubmark"
              style={{ left: hubPoint.x, top: hubPoint.y, x: "-50%", y: "-50%", opacity: markOpacity, scale: markScale }}
              aria-hidden="true"
            >
              <MorvaMark size={26} />
              <span className="chip-chain">your balance</span>
            </motion.div>
          )}

          <div className="hero2-c c-zone">
            <motion.div className="c-dots c-dots-bg" style={{ opacity: cOpacity }} aria-hidden="true" />
            <div className="container c-inner" inert={!phase.cReady}>
              <motion.div style={{ opacity: cOpacity, y: cY }}>
                <SectionHeading />
              </motion.div>
              <div className="c-grid">
                {wide && (
                  <motion.div className="c-left" style={{ opacity: cOpacity, y: cY }}>
                    <SectionLead />
                    {list}
                  </motion.div>
                )}
                <div ref={slot} className="c-right">
                  <motion.div style={{ x: panelX, y: panelY, opacity: panelOpacity }} className="hero2-panel">
                    <Stage scene={feature} />
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {!wide && (
        <div className="container hero2-mobile-list c-zone">
          <SectionLead />
          {list}
        </div>
      )}
    </>
  );
}
