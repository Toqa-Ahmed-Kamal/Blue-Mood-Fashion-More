"use client";

import { useSyncExternalStore } from "react";

import { emptyCart, sanitizeCart, type Cart } from "@/lib/cart";

const STORAGE_KEY = "blue-mood-cart-v1";

let state: Cart = emptyCart;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) state = sanitizeCart(JSON.parse(saved));
  } catch {
    state = emptyCart;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    loaded = false;
    load();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  load();
  return state;
}

function getServerSnapshot() {
  return emptyCart;
}

export function updateCart(updater: (cart: Cart) => Cart) {
  load();
  state = updater(state);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode); the cart still works for this visit.
  }
  emit();
}

/** The cart exactly as saved in this browser, before invalid pieces are dropped (to tell the customer what was removed). */
export function readSavedCartRaw(): { offer?: { productIds?: unknown } | null; items?: { productId?: unknown }[] } | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function useCart() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
