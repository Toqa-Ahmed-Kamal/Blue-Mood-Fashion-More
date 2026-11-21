// Runs in the browser before the app becomes interactive (Next.js convention).
// Many customers open the store from Facebook / Instagram on older phones (e.g. iPhone 6s / 7, stuck on
// iOS 15). Their browsers lack a few newer built-ins the code uses; without these the cart or the
// "تأكيد الطلب" button can fail silently. Each one is added only when missing.
import "./lib/legacy-polyfills";
