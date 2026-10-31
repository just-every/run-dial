import { createLink } from "@tanstack/react-router";
import type { ComponentPropsWithRef, InputHTMLAttributes, PropsWithChildren, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Icon, type IconName } from "../../shared/drawing/icons";

// A field on a row-filled panel takes the card fill so it still reads as a field; everywhere else it is a faint wash on the card.
const fieldControl = "min-h-11 rounded-xl border border-line bg-field px-3.5 text-[15px] leading-[1.45] text-ink outline-none transition-[border-color] placeholder:text-muted focus:border-ink in-[.bg-row]:bg-card disabled:cursor-not-allowed disabled:bg-wash disabled:text-muted";
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

/** Every button is a pill. Links that act as buttons take the same classes. */
export function buttonClassName(variant: ButtonVariant = "primary", className = "") {
  const styles = {
    primary: "bg-ink text-white shadow-lift hover:bg-ink-hover disabled:bg-wash disabled:text-muted disabled:shadow-none",
    secondary: "border border-line bg-card text-ink hover:border-ink disabled:bg-wash disabled:text-muted disabled:hover:border-line",
    quiet: "px-1 text-ink underline decoration-[1.5px] underline-offset-[5px] hover:decoration-gold-deep disabled:text-muted",
    danger: "border border-danger-line bg-danger-wash text-danger hover:border-danger disabled:opacity-60",
  };
  const padding = variant === "quiet" ? "" : "px-5";
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-full ${padding} text-[15px] font-semibold leading-tight transition-[border-color] disabled:cursor-not-allowed ${styles[variant]} ${className}`;
}

export function Button({ className = "", variant = "primary", icon, children, ...props }: ComponentPropsWithRef<"button"> & { variant?: ButtonVariant; icon?: IconName }) {
  return <button className={buttonClassName(variant, className)} {...props}>{icon ? <Icon name={icon} className="line-icon h-5 w-5" /> : null}{children}</button>;
}

/** An inline text link in ink, underlined, with the landing's gold-deep underline on hover. */
export const textLinkClassName = "font-semibold text-ink underline decoration-[1.5px] underline-offset-[5px] hover:decoration-gold-deep";

/** A router link that never carries aria-current: only the menu marks the current page, and only its longest matching entry. */
export const PlainLink = createLink((props: ComponentPropsWithRef<"a">) => <a {...props} aria-current={undefined}>{props.children}</a>);

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldControl} w-full ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldControl} w-full ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldControl} min-h-28 w-full py-3 ${className}`} {...props} />;
}

export function Card({ className = "", children, id }: PropsWithChildren<{ className?: string; id?: string }>) {
  return <section id={id} className={`rounded-[18px] bg-card shadow-panel sm:rounded-[22px] ${className}`}>{children}</section>;
}

/** A status chip: a pill with a dot before the label. The label is the state word as the API gives it. */
export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "danger" }>) {
  const styles = {
    neutral: "bg-wash text-soft",
    success: "bg-gold-wash text-ink",
    warning: "bg-wash text-ink",
    danger: "bg-danger-wash text-danger",
  };
  const dots = {
    neutral: null,
    success: <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />,
    warning: <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full border-[1.5px] border-ink" />,
    danger: <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-danger" />,
  };
  return <span className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold leading-none ${styles[tone]}`}>{dots[tone]}{children}</span>;
}

/** Panels for status messages: success (role="status"), error (role="alert") and warning notices. */
export function noticeClassName(tone: "success" | "error" | "warning", className = "") {
  const styles = {
    success: "bg-gold-wash text-ink",
    error: "bg-danger-wash text-danger",
    warning: "border border-gold-line bg-gold-wash text-ink",
  };
  return `rounded-[14px] p-3 text-sm leading-6 ${styles[tone]} ${className}`;
}

/** The gold-deep "!" that marks a warning row. Decorative: the row's text says what needs attention. */
export function WarningMark() {
  return <span aria-hidden="true" className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-gold-deep text-[13px] font-extrabold leading-none text-white">!</span>;
}

/** The 40px gold-wash tile that holds a card title's icon, drawn a little heavier than inline icons. */
export function IconTile({ icon }: { icon: IconName }) {
  return <span aria-hidden="true" className="icon-tile grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-wash text-ink"><Icon name={icon} className="line-icon h-[22px] w-[22px]" /></span>;
}

/**
 * A single choice shown as pills in a wash track: a radio group named by its visible label. Changing it calls `onChange` with
 * the option's value, as the select it replaces did. The label sits above the track on phones (always, when `stacked`), and on
 * phones the options form a two-column grid of equal pills, so no option is cut off or scrolled out of view.
 */
export function Segmented<T extends string>({ label, name, value, options, onChange, stacked = false }: { label: string; name: string; value: T; options: ReadonlyArray<readonly [NoInfer<T>, string]>; onChange(value: NoInfer<T>): void; stacked?: boolean }) {
  return <div className={`grid min-w-0 gap-2 ${stacked ? "" : "sm:flex sm:items-center sm:gap-3"}`}>
    <span id={`${name}-label`} className="shrink-0 text-sm font-[650] text-ink">{label}</span>
    <div role="radiogroup" aria-labelledby={`${name}-label`} className="grid w-full min-w-0 grid-cols-2 gap-[3px] rounded-[20px] bg-wash p-[3px] sm:flex sm:w-fit sm:gap-0 sm:rounded-full">
      {options.map(([option, text]) => <label key={option} className="relative min-w-0 cursor-pointer">
        <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} className="peer absolute inset-0 m-0 cursor-pointer opacity-0" />
        <span className="flex min-h-9 items-center justify-center whitespace-nowrap rounded-full px-3 text-sm font-semibold text-soft peer-checked:bg-gold-wash peer-checked:text-ink peer-checked:shadow-lift peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink sm:px-4">{text}</span>
      </label>)}
    </div>
  </div>;
}
