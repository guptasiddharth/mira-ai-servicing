"use client";

import { forwardRef } from "react";

export type OrbState = "idle" | "thinking" | "listening" | "speaking";

/**
 * The assistant's visual identity: a living orb. It idles softly, swirls when
 * thinking, and pulses with audio (the parent sets `--level` 0..1 on the ref).
 */
export const Orb = forwardRef<HTMLDivElement, { size?: number; state?: OrbState; className?: string }>(function Orb({ size = 28, state = "idle", className = "" }, ref) {
  return (
    <div ref={ref} className={`orb orb-${state} ${className}`} style={{ width: size, height: size }} aria-hidden>
      <div className="orb-glow" />
      <div className="orb-core" />
      <div className="orb-shine" />
    </div>
  );
});
