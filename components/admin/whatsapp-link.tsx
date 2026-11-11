"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";

import { retargetWhatsApp, type WhatsAppTarget } from "@/lib/customer-whatsapp";

const TARGET_KEY = "bm-wa-target";
const listeners = new Set<() => void>();

function deviceDefault(): WhatsAppTarget {
  // Phones open the WhatsApp app; computers open WhatsApp Web directly (no redirect page).
  return window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent) ? "app" : "web";
}

function readTarget(): WhatsAppTarget {
  try {
    const saved = window.localStorage.getItem(TARGET_KEY);
    if (saved === "web" || saved === "app" || saved === "universal") return saved;
  } catch {
    // Storage blocked: use the device default.
  }
  return deviceDefault();
}

/** Where WhatsApp chats open (remembered on this device). */
export function useWhatsAppTarget() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readTarget,
    () => "universal" as WhatsAppTarget,
  );
}

function setTarget(target: WhatsAppTarget) {
  try {
    window.localStorage.setItem(TARGET_KEY, target);
  } catch {
    // Not remembered, still used now.
  }
  listeners.forEach((listener) => listener());
}

/** The app link opens in the same tab (it hands over to WhatsApp); web pages open in a new tab. */
const linkProps = (href: string, target: WhatsAppTarget) =>
  target === "app" ? { href } : { href, target: "_blank", rel: "noreferrer" };

/** Opens a WhatsApp chat with the customer, message ready to send (or explains why it can't). */
export function WhatsAppLink({ href, label, compact = false, text }: { href: string | null; label: string; compact?: boolean; text?: string }) {
  const target = useWhatsAppTarget();
  if (!href) return compact ? null : <span className="admin-muted small-inline">رقم الموبايل مش رقم واتساب مصري</span>;
  return (
    <a className={`admin-wa${compact ? " compact" : ""}`} {...linkProps(retargetWhatsApp(href, target), target)} title={label} aria-label={label}>
      <MessageCircle size={compact ? 15 : 16} aria-hidden="true" />
      <span>{text ?? (compact ? "مش متوفر؟" : label)}</span>
    </a>
  );
}

/** WhatsApp button with ready messages to choose from (each opens the chat with that message). */
export function WhatsAppMenu({ options }: { options: { label: string; href: string | null }[] }) {
  const target = useWhatsAppTarget();
  const menuRef = useRef<HTMLDetailsElement>(null);

  // Closes when the admin clicks anywhere else or presses Escape, so it never covers other buttons.
  useEffect(() => {
    const close = (event: Event) => {
      const menu = menuRef.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  const usable = options.filter((option): option is { label: string; href: string } => option.href !== null);
  if (usable.length === 0) return <span className="admin-muted small-inline">رقم الموبايل مش رقم واتساب مصري</span>;
  return (
    <details className="admin-wa-menu" ref={menuRef}>
      <summary className="admin-wa">
        <MessageCircle size={16} aria-hidden="true" /> <span>واتساب العميلة</span> <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="admin-wa-options" role="menu">
        {usable.map((option) => (
          <a key={option.label} role="menuitem" {...linkProps(retargetWhatsApp(option.href, target), target)} onClick={() => { if (menuRef.current) menuRef.current.open = false; }}>{option.label}</a>
        ))}
      </div>
    </details>
  );
}

/** Lets the admin choose where chats open (WhatsApp Web, the WhatsApp app, or WhatsApp's own page). */
export function WhatsAppTargetPicker() {
  const target = useWhatsAppTarget();
  return (
    <label className="admin-wa-target">
      <MessageCircle size={14} aria-hidden="true" /> الواتساب يفتح في
      <select value={target} onChange={(event) => setTarget(event.target.value as WhatsAppTarget)} aria-label="الواتساب يفتح في">
        <option value="web">واتساب ويب (الكمبيوتر)</option>
        <option value="app">تطبيق الواتساب</option>
        <option value="universal">صفحة واتساب (لو الاتنين مش شغالين)</option>
      </select>
    </label>
  );
}
