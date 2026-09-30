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
 */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { PanelBoundary } from "@/components/PanelBoundary";

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
  xs: "px-1.5 py-0.5 text-[11px]",
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize };

/** An anchor that looks like a Button -- for navigation, downloads, new tabs. */
export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}

// ------------------------------------------------------------------ Fields

const FIELD =
  "w-full rounded border border-white/15 bg-black/40 text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none";
const FIELD_SIZE = { sm: "px-2 py-1 text-xs", md: "px-2.5 py-1.5 text-sm" } as const;

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
      className={cx("streamy-select", FIELD, fieldSize === "sm" ? "py-1 pl-2 text-xs" : "py-1.5 pl-2.5 text-sm", className)}
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

// ------------------------------------------------------------------- Badge

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-white/10 text-white/55",
  success: "bg-emerald-500/20 text-emerald-300",
  warning: "bg-amber-500/20 text-amber-300",
  danger: "bg-red-500/20 text-red-300",
  info: "bg-sky-500/20 text-sky-300",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: BadgeTone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", BADGE_TONE[tone], className)}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------ Panel/Section

/** The admin card: dark, bordered, padded. */
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
