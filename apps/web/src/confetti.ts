/**
 * A small, dependency-free confetti burst inside a canvas: it fills its
 * parent, shoots up from the bottom centre and falls back within the box.
 * Skipped for visitors who prefer reduced motion. Returns a cleanup.
 */
export function confettiIn(canvas: HTMLCanvasElement): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  // The map is zoomed by a CSS transform, so draw at 2x to stay crisp.
  const dpr = 2;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7", "#14b8a6"];
  const parts = Array.from({ length: 46 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
    const speed = 3 + Math.random() * 3.2;
    return {
      x: w / 2 + (Math.random() - 0.5) * 30,
      y: h + 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)]!,
    };
  });

  const LIFE = 1600;
  const start = performance.now();
  let raf = 0;
  const frame = (t: number) => {
    const age = t - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, Math.max(0, (LIFE - age) / 400));
    for (const p of parts) {
      p.vy += 0.12;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      // Bounce off the card's sides so it stays a burst inside the card.
      if (p.x < 0 || p.x > w) p.vx *= -0.6;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (age < LIFE) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
