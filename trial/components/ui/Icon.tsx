/** Hairline icons drawn for this app: 1.5 px strokes on a 24 grid, currentColor. */

const paths = {
  info: "M12 11v5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  warn: "M12 9v4M12 17h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  error: "M15 9l-6 6M9 9l6 6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  check: "M20 6 9 17l-5-5",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3",
  speaker: "M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  wind: "M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  play: "M7 4v16l13-8L7 4Z",
  stop: "M7 7h10v10H7z",
  pause: "M8 5v14M16 5v14",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  notes: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
  wave: "M2 12h2M6 8v8M10 5v14M14 9v6M18 7v10M22 12h-2",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  rewind: "M11 6 4 12l7 6V6ZM20 6l-7 6 7 6V6Z",
  focus: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01",
  // Moments, Ask and the earbuds.
  moment: "M6.5 3.5h11v17l-5.5-4-5.5 4v-17Z",
  ask: "M20.5 11.5a8 8 0 0 1-11.6 7.2L4 20l1.3-4.4A8 8 0 1 1 20.5 11.5ZM8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01",
  earbud: "M9.5 3.5a5 5 0 0 0-1 9.9V19a2 2 0 0 0 4 0V8.5a5 5 0 0 0-3-5ZM16.5 7.5a4.5 4.5 0 0 1 0 6M19 5a8 8 0 0 1 0 11",
  more: "M4.5 4.5h5v5h-5zM14.5 4.5h5v5h-5zM4.5 14.5h5v5h-5zM14.5 14.5h5v5h-5z",
  calendar: "M4.5 5.5h15v15h-15zM4.5 10h15M8.5 3v4M15.5 3v4",
  bell: "M6.5 16v-5a5.5 5.5 0 1 1 11 0v5l1.5 2h-14l1.5-2ZM10 21h4",
  share: "M12 15V3.5M8 7.5l4-4 4 4M5.5 12v8.5h13V12",
  pencil: "M4.5 19.5h4l10-10-4-4-10 10v4ZM12.5 7.5l4 4",
  close: "M6 6l12 12M18 6 6 18",
  pin: "M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  person: "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0",
  send: "M12 19.5v-15M5.5 11 12 4.5l6.5 6.5",
  copy: "M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4",
  chevron: "m9 6 6 6-6 6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={paths[name]} />
    </svg>
  );
}
