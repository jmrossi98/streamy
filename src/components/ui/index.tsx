/**
 * Streamy's shared UI primitives. Reach for these before hand-rolling a
 * button, field, card or badge, so every page shares one look.
 *
 * Contexts, since that is where one-off classes have gone wrong before:
 *   - Panel / AdminSection: admin pages' cards. Not for the media browse
 *     pages, which are full-bleed.
 *   - Chip: toggle filters (on/off, any number at once). An exclusive choice
 *     among many is a Select.
 *   - Select: always the `.streamy-select` class (globals.css), which draws the
 *     arrow and sets `color-scheme: dark` so the option popup isn't light.
 *   - Badge: status, not action. Clickable things are Buttons.
 *   - Checkbox: an on/off setting with its label (a row's switches).
 *   - PosterIconButton: the round controls laid over poster artwork.
 *   - TabBar / TabLink: one page split into sections, each with its own URL
 *     (the admin area, Live TV). A Chip row is for filters within one view.
 */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import Link from "next/link";
import { PanelBoundary } from "@/components/PanelBoundary";
import { TabPending } from "./TabPending";
export { Artwork } from "./Artwork";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ Button

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-netflix-red text-white hover:bg-netflix-red/90",
  secondary: "border border-white/20 text-white/80 hover:bg-white/10 hover:text-white",
  ghost: "text-white/55 hover:bg-white/10 hover:text-white",
  danger: "border border-red-400/40 text-red-300 hover:bg-red-500/15",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  // Minimum heights so the small sizes stay tappable on a phone (28/32 px)
  // without growing the text.
  xs: "min-h-7 px-2 py-0.5 text-[11px]",
  sm: "min-h-8 px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/**
 * The round overlay control on poster tiles (My List +/−, the admin's
 * download). Sits on artwork, so it carries its own dark backing.
 */
export function PosterIconButton({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "pointer-events-auto flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-full border border-white/35 bg-black/75 text-white shadow-lg transition-all hover:scale-105 hover:bg-black/90 active:scale-100 disabled:opacity-60",
        className
      )}
      {...rest}
    />
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize };

/** An anchor that looks like a Button -- for navigation, downloads, new tabs. */
export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}

// ------------------------------------------------------------------ Fields

const FIELD =
  "w-full rounded border border-white/15 bg-black/40 text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none";
// 16px on phones: iOS Safari zooms the page into any field whose text is smaller.
const FIELD_SIZE = { sm: "px-2 py-1 text-base sm:text-xs", md: "px-2.5 py-1.5 text-base sm:text-sm" } as const;

export function TextInput({ className, fieldSize = "md", ...rest }: InputHTMLAttributes<HTMLInputElement> & { fieldSize?: "sm" | "md" }) {
  return <input className={cx(FIELD, FIELD_SIZE[fieldSize], className)} {...rest} />;
}

export function TextArea({ className, fieldSize = "md", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { fieldSize?: "sm" | "md" }) {
  return <textarea className={cx(FIELD, FIELD_SIZE[fieldSize], className)} {...rest} />;
}

export function Select({ className, fieldSize = "md", ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { fieldSize?: "sm" | "md" }) {
  // pr is left to .streamy-select, which reserves room for its arrow.
  return (
    <select
      className={cx("streamy-select", FIELD, fieldSize === "sm" ? "py-1 pl-2 text-base sm:text-xs" : "py-1.5 pl-2.5 text-base sm:text-sm", className)}
      {...rest}
    />
  );
}

/** A label above a control, with an optional hint under it. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs text-white/50">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-white/35">{hint}</span>}
    </label>
  );
}

/**
 * A labelled checkbox: an on/off setting on a row, e.g. a board's Poll and
 * Email switches. Added 2026-10-24 so rows stop hand-rolling their own.
 * `title` explains the setting on hover.
 */
export function Checkbox({
  label,
  title,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label title={title} className={cx("flex cursor-pointer items-center gap-1 text-white/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40", className)}>
      <input type="checkbox" className="accent-netflix-red" {...rest} />
      <span>{label}</span>
    </label>
  );
}

// -------------------------------------------------------------------- Chip

/** A toggle filter. `active` is the on state; several can be on at once. */
export function Chip({
  active,
  className,
  size = "sm",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; size?: "xs" | "sm" }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cx(
        "rounded-full transition-colors",
        size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
        active ? "bg-white font-semibold text-netflix-black" : "bg-white/10 text-white/70 hover:bg-white/20",
        className
      )}
      {...rest}
    />
  );
}

// -------------------------------------------------------- SegmentedControl

export type Segment<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Hover text: what the option means, or why it is greyed out. */
  title?: string;
};

/**
 * One choice out of a few, all visible: the chat's Local / Open / Claude and
 * the skill engine (2026-10-25, when both moved into Model routing). Use a
 * Select once the options stop fitting on a phone row.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("flex items-center gap-1 rounded-lg bg-white/5 p-1", className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            title={o.title}
            disabled={disabled || o.disabled}
            onClick={() => {
              if (!selected) onChange(o.value);
            }}
            className={cx(
              "min-h-9 flex-1 rounded px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30",
              selected ? "bg-netflix-red text-white disabled:opacity-60" : "text-white/60 hover:bg-white/10 hover:text-white/90"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------------- Tabs

/**
 * The underlined tab strip the admin area has always had, extracted so Live
 * TV's tabs look the same rather than a second interpretation of "tabs".
 *
 * Scrolls rather than wraps: neither set fits a phone, and a wrapped second
 * row pushes the page content down on every screen.
 */
export function TabBar({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className={cx("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-1 border-b border-white/10 pb-px">{children}</ul>
    </nav>
  );
}

/**
 * One tab. A link, not a button: every tab is a URL, so it can be opened in
 * a new tab, bookmarked, and returned to with the back button.
 */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative block whitespace-nowrap rounded-t px-3 py-2 text-sm font-medium transition-colors",
          active ? "border-b-2 border-netflix-red text-white" : "border-b-2 border-transparent text-white/50 hover:text-white/80"
        )}
      >
        {children}
        <TabPending />
      </Link>
    </li>
  );
}

// ------------------------------------------------------------------- Badge

/** Status tones, plus brand tones for where something came from (Streamy, Claude, ChatGPT). */
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "streamy" | "claude" | "chatgpt";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-white/10 text-white/55",
  success: "bg-emerald-500/20 text-emerald-300",
  warning: "bg-amber-500/20 text-amber-300",
  danger: "bg-red-500/20 text-red-300",
  info: "bg-sky-500/20 text-sky-300",
  streamy: "bg-netflix-red/20 text-netflix-red",
  claude: "bg-orange-500/20 text-orange-300",
  chatgpt: "bg-white/20 text-white",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: BadgeTone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium", BADGE_TONE[tone], className)}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------ Panel/Section

/** The admin card: dark, bordered, padded. */
/**
 * The one height at which an admin list stops growing and scrolls inside
 * itself.
 *
 * Every long list on the dashboard uses this -- service rows, probe runs, the
 * visitor log, sessions earlier today, accounts -- so a tab's length is set by
 * how many panels it has, not by how busy the day was. Before 2026-10-18 there
 * were nine different heights across the admin and several lists with none,
 * and each one was asked for separately. `tall` is for a table that is the
 * whole point of its panel (the visitor log, job listings), where more rows on
 * screen earn the room.
 */
export const SCROLL_LIST_MAX_H = "max-h-80";
export const SCROLL_LIST_MAX_H_TALL = "max-h-[32rem]";

export function scrollListClass(opts: { tall?: boolean } = {}, extra?: string): string {
  return cx(opts.tall ? SCROLL_LIST_MAX_H_TALL : SCROLL_LIST_MAX_H, "overflow-y-auto overscroll-contain pr-1", extra);
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-lg border border-white/10 bg-netflix-dark/80 px-4 py-5 sm:px-6", className)}>{children}</div>;
}

/**
 * An admin page section: heading, card, and an error boundary so one broken
 * panel can't take the page down. `name` defaults to the title.
 */
export function AdminSection({
  title,
  name,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  name?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {actions}
      </div>
      <Panel className={className}>
        <PanelBoundary name={name ?? (typeof title === "string" ? title : "Section")}>{children}</PanelBoundary>
      </Panel>
    </section>
  );
}
