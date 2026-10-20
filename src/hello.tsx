import { useEffect, useRef } from "react";
import { canSignIn } from "./account";
import { SignIn } from "./signin";

// The first thing a new library shows: sign in, or carry on without. Printed matter rather than app
// chrome: warm paper, black ink, one vermillion. On the left an artwork drawn live: a record in halftone
// with a light turning across it, a dot circling it, and ink that spreads where the pointer goes.
const PAPER = "#efe9dd", INK = "#111", RED = "#ff4a1c";

export function Hello({ onSkip }: { onSkip: () => void }) {
  return (
    <div
      data-tauri-drag-region
      className="fixed inset-0 z-[100] grid grid-cols-[minmax(0,1.2fr)_minmax(400px,1fr)] bg-[#efe9dd] text-[#111] [color-scheme:light] [--color-accent:#ff4a1c] [--color-ink:#111] [--color-muted:rgb(17_17_17/0.6)] [--color-paper:#efe9dd]"
    >
      <div data-tauri-drag-region className="relative min-h-0 overflow-hidden">
        <Artwork />
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto border-l-[1.5px] border-[#111] px-[clamp(32px,5vw,80px)] pt-16 pb-10">
        <div className="my-auto animate-[rise_800ms_var(--ease-out)_200ms_both] py-8">
          {canSignIn ? <SignIn poster /> : <h1 className="text-[clamp(44px,5.4vw,76px)] leading-[0.9] font-black tracking-[-0.055em]">Welcome</h1>}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t-[1.5px] border-[#111] pt-5 text-sm">
          <p className="max-w-[34ch] min-w-[22ch] flex-1 text-[#111]/60">{canSignIn ? "An account keeps your library the same on every computer. It’s optional." : "Your library stays on this computer."}</p>
          <button onClick={onSkip} className="group flex shrink-0 items-center gap-2 font-semibold hover:text-[#ff4a1c]">
            {canSignIn ? "Continue without an account" : "Continue"}
            <span className="transition-transform duration-300 ease-(--ease-out) group-hover:translate-x-1">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const TAU = Math.PI * 2;
function Artwork() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0, raf = 0;
    const fit = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      (w = canvas.clientWidth), (h = canvas.clientHeight);
      (canvas.width = w * dpr), (canvas.height = h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    // The pointer, followed with a little lag.
    const p = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4 };
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      (p.tx = e.clientX - r.left), (p.ty = e.clientY - r.top);
    };
    addEventListener("pointermove", move);
    const t0 = performance.now();

    const draw = (now: number) => {
      const t = Math.max(0, now - t0) / 1000; // the first frame can be stamped a touch before t0
      if (p.x < -1e3) (p.x = p.tx), (p.y = p.ty);
      (p.x += (p.tx - p.x) * 0.1), (p.y += (p.ty - p.y) * 0.1);
      ctx.clearRect(0, 0, w, h);
      const S = Math.max(7, Math.round(Math.min(w, h) / 78)); // the screen's pitch
      const R = Math.min(w * 0.36, h * 0.34);
      const cx = w * 0.5, cy = h * 0.5;
      const spin = t * 0.35;
      const grow = 1 - (1 - Math.min(1, t / 1.8)) ** 3; // the ink comes in from the middle
      const diag = Math.hypot(w, h), reach = Math.min(w, h) * 0.2;
      const dots = new Path2D();
      for (let gy = S / 2, row = 0; gy < h + S; gy += S * 0.866, row++) {
        for (let gx = (row % 2) * (S / 2); gx < w + S; gx += S) {
          let x = gx, y = gy, v: number;
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
          if (d < R * 0.35) continue; // the label is printed solid, after
          if (d < R) {
            // The record: near-solid ink, its grooves a shade lighter, and a light that turns across it.
            const a = Math.atan2(dy, dx);
            const light = Math.max(0, Math.cos(2 * (a - spin))) ** 6;
            v = 0.95 - 0.14 * (0.5 + 0.5 * Math.sin(d * 0.45)) - light * 0.72;
            v *= Math.min(1, (R - d) / S + 0.4);
          } else {
            // The paper: a tone that gathers into the bottom-left corner, and the record's shadow.
            const q = Math.max(0, 1 - Math.hypot(x, h - y) / (diag * 0.62));
            const shadow = Math.max(0, 1 - Math.abs(Math.hypot(x - cx - R * 0.07, y - cy - R * 0.09) - R) / (R * 0.12)) * (d > R ? 0.35 : 0);
            v = Math.max(q ** 2.4 * 0.8, shadow);
          }
          const pd = Math.hypot(x - p.x, y - p.y);
          if (pd < reach) {
            const k = (1 - pd / reach) ** 2;
            v += k * 0.45;
            x += ((x - p.x) / (pd || 1)) * k * S * 0.9;
            y += ((y - p.y) / (pd || 1)) * k * S * 0.9;
          }
          const r = Math.min(1, v) * S * 0.58 * Math.min(1, Math.max(0, grow * 1.6 - d / diag));
          if (r < 0.3) continue;
          dots.moveTo(x + r, y);
          dots.arc(x, y, r, 0, TAU);
        }
      }
      ctx.fillStyle = INK;
      ctx.fill(dots);
      // The label, a touch off register as a print would be, and the spindle hole.
      const lr = R * 0.35 * grow;
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(cx + R * 0.012, cy - R * 0.008, lr, 0, TAU);
      ctx.fill();
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.035, 0, TAU);
      ctx.fill();
      // An orbit, and a dot going round it.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.24, 0, TAU * grow);
      ctx.stroke();
      const a = -t * 0.3 - Math.PI / 2;
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * R * 1.24, cy + Math.sin(a) * R * 1.24, Math.max(4, S * 0.6) * grow, 0, TAU);
      ctx.fill();
      // Registration marks down the right edge.
      for (const [mx, my] of [[w - 36, 36], [w - 36, h - 36]]) {
        ctx.beginPath();
        ctx.arc(mx, my, 8, 0, TAU);
        ctx.moveTo(mx - 14, my), ctx.lineTo(mx + 14, my);
        ctx.moveTo(mx, my - 14), ctx.lineTo(mx, my + 14);
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => (cancelAnimationFrame(raf), ro.disconnect(), removeEventListener("pointermove", move));
  }, []);
  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />;
}
