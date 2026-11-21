// Small polyfills for older phone browsers (see instrumentation-client.ts). Each is defined only when the
// browser does not have it, so modern browsers are untouched.

function define(target: object, name: string, value: unknown) {
  if (typeof (target as Record<string, unknown>)[name] === "function") return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

type Compare<T> = ((a: T, b: T) => number) | undefined;

define(Array.prototype, "toSorted", function toSorted<T>(this: T[], compare?: Compare<T>) {
  return this.slice().sort(compare);
});
define(Array.prototype, "toReversed", function toReversed<T>(this: T[]) {
  return this.slice().reverse();
});
define(Array.prototype, "at", function at<T>(this: T[], index: number) {
  const whole = Math.trunc(index) || 0;
  return this[whole < 0 ? this.length + whole : whole];
});
define(Array.prototype, "findLast", function findLast<T>(this: T[], test: (item: T, index: number, list: T[]) => unknown) {
  for (let index = this.length - 1; index >= 0; index -= 1) if (test(this[index], index, this)) return this[index];
  return undefined;
});
define(String.prototype, "at", function at(this: string, index: number) {
  const whole = Math.trunc(index) || 0;
  return this.charAt(whole < 0 ? this.length + whole : whole) || undefined;
});
define(String.prototype, "replaceAll", function replaceAll(this: string, search: string | RegExp, replacement: string) {
  return typeof search === "string" ? this.split(search).join(replacement) : this.replace(search, replacement);
});
define(Object, "hasOwn", (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key));

if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function" && typeof crypto.randomUUID !== "function") {
  define(crypto, "randomUUID", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  });
}

export {};
