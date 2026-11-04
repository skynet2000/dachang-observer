import { SITE } from "../site.ts";

/** An architectural 厂 with a warm lit window. */
function ObservationMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <rect width="40" height="40" rx="9" fill="#291e44" />
    <g className={spinning ? "brand-mark-spinning" : undefined}>
      <path d="M14 11h18v5H18l-5 14H7z" fill="#fff3e2" />
      <path d="M23 21h9v9H20z" fill="#ffad68" />
    </g>
  </svg>;
}

export function Wordmark({ size = 24, className = "", title = SITE.name }: { size?: number; className?: string; title?: string }) {
  return <span className={`brand-wordmark inline-flex items-center gap-[0.45em] font-black leading-none tracking-[-0.04em] ${className}`} style={{ fontSize: Math.round(size * 0.92) }} aria-label={title} role="img">
    <ObservationMark className="size-[1.5em] shrink-0" />
    <span aria-hidden="true">{SITE.name}</span>
  </span>;
}

/** Shared brand mark for the account entry and loading states. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return <ObservationMark className={className} spinning={spinning} />;
}
