"use client";

import { MessageCircle } from "lucide-react";

/** Opens a WhatsApp chat with the customer, message ready to send (or explains why it can't). */
export function WhatsAppLink({ href, label, compact = false }: { href: string | null; label: string; compact?: boolean }) {
  if (!href) return compact ? null : <span className="admin-muted small-inline">رقم الموبايل مش رقم واتساب مصري</span>;
  return (
    <a className={`admin-wa${compact ? " compact" : ""}`} href={href} target="_blank" rel="noreferrer" title={label} aria-label={label}>
      <MessageCircle size={compact ? 15 : 16} aria-hidden="true" />
      {compact ? <span>مش متوفر؟</span> : <span>{label}</span>}
    </a>
  );
}
