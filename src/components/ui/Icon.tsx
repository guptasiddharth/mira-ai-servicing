/** Small inline icon set (stroke icons, currentColor). */

const PATHS: Record<string, string> = {
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z",
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h4",
  copy: "M9 9h10v10H9zM5 15V5h10",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 1 1 8 0v3",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  calculator: "M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h13v4H6a2 2 0 0 1-2-2Z",
  send: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12l5 5L20 7",
  x: "M6 6l12 12M18 6 6 18",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
  chevron: "M9 6l6 6-6 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  ticket: "M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 0 0-4V4H3v4Zm10-4v12",
  loan: "M3 10h18M5 10V20M9 10v10M15 10v10M19 10v10M3 20h18M12 3l9 5H3l9-5Z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm6-3a6 6 0 0 1-12 0m6 6v3",
  phoneOff: "M10.7 13.3a13 13 0 0 1-2.4-3.2l1.6-1.6a1 1 0 0 0 .2-1.1L8.7 4.2A1 1 0 0 0 7.6 3.6l-3 .7A1 1 0 0 0 3.8 5.3 17 17 0 0 0 18.7 20.2a1 1 0 0 0 1-.8l.7-3a1 1 0 0 0-.6-1.1l-3.2-1.4a1 1 0 0 0-1.1.2l-1.6 1.6a13 13 0 0 1-1.1-.6M3 3l18 18",
  activity: "M3 12h4l3-8 4 16 3-8h4",
};

export function Icon({ name, className = "h-4 w-4", strokeWidth = 2 }: { name: string; className?: string; strokeWidth?: number }) {
  const d = PATHS[name] ?? PATHS.sparkles;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
