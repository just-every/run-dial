// Line icons for the landing's feature lists and rule chips and the app's navigation and cards, drawn on a 32-unit grid with round 2.3-unit ink strokes.

const paths = {
  clock: "M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24ZM16 9v7.5l5 3",
  overrides: "M8 7h16a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3ZM5 13h22M11 4v6M21 4v6M13 25l1-4 6-6 3 3-6 6Z",
  buffers: "M8 6v20M24 6v20M12.5 16h7M14.5 13l-2 3 2 3M17.5 13l2 3-2 3",
  notice: "M9 4h14M9 28h14M10 4c0 8 12 6 12 12s-12 4-12 12M22 4c0 8-12 6-12 12s12 4 12 12",
  limits: "M5 7h22M8 27V17M14 27V12M20 27V15M26 27V11",
  daylight: "M16 10a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1",
  calendar: "M8 7h16a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3ZM5 13h22M11 4v6M21 4v6M10.5 19h3M18.5 19h3M10.5 23.5h3",
  file: "M9 4h10l6 6v18H9ZM19 4v6h6M12.5 17h7M12.5 21.5h5",
  mail: "M6.5 7h19A2.5 2.5 0 0 1 28 9.5v13a2.5 2.5 0 0 1-2.5 2.5h-19A2.5 2.5 0 0 1 4 22.5v-13A2.5 2.5 0 0 1 6.5 7ZM5 9l11 9 11-9",
  bell: "M8 22h16l-2.5-4v-6a5.5 5.5 0 0 0-11 0v6ZM13.5 26a2.5 2.5 0 0 0 5 0M16 3.5v3",
  cloud: "M9 25h15a6 6 0 0 0 .8-11.95A8.5 8.5 0 0 0 8.4 14.6 5.3 5.3 0 0 0 9 25Z",
  download: "M16 5v15M10 14l6 6 6-6M6 22v5h20v-5",
  restore: "M6 13a10.5 10.5 0 1 1 1.5 9M6 5v8h8",
  code: "M11 9l-7 7 7 7M21 9l7 7-7 7M18.5 6l-5 20",
  link: "M13.5 18.5l5-5M11.5 14.5l-3 3a4.3 4.3 0 0 0 6 6l3-3M20.5 17.5l3-3a4.3 4.3 0 0 0-6-6l-3 3",
  check: "M8 16.5l5 5 11-12",
  people: "M12 7a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM3.5 26a8.5 8.5 0 0 1 17 0M21 7.6a4.5 4.5 0 0 1 0 8.8M23 18.5a8.5 8.5 0 0 1 5.5 7.5",
  pin: "M16 28s-9-8.2-9-15a9 9 0 0 1 18 0c0 6.8-9 15-9 15ZM16 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
  shield: "M16 4l10 4v7c0 6.5-4.3 11-10 13-5.7-2-10-6.5-10-13V8ZM11.5 16l3.2 3.2 6-6.4",
  message: "M7 6h18a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H14l-6 5v-5H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3ZM10 12.5h12M10 17h8",
  user: "M16 5.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM6 27.5a10 10 0 0 1 20 0",
  alert: "M16 5L3.5 26.5h25ZM16 13v6M16 22.5v.5",
  home: "M5 14.5L16 5l11 9.5M8 12v15h16V12M13 27v-7h6v7",
  gear: "M13.7 6.7L14 3.6h4l.3 3.1 2.6 1.1 2.5-2 2.8 2.8-2 2.5 1.1 2.6 3.1.3v4l-3.1.3-1.1 2.6 2 2.5-2.8 2.8-2.5-2-2.6 1.1-.3 3.1h-4l-.3-3.1-2.6-1.1-2.5 2-2.8-2.8 2-2.5-1.1-2.6-3.1-.3v-4l3.1-.3 1.1-2.6-2-2.5 2.8-2.8 2.5 2ZM16 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
} as const;

export type IconName = keyof typeof paths;

/** A decorative line icon; the text beside it carries the meaning. */
export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
