// Generates the values for ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET.
// Usage: npm run admin:hash   (asks for the password; it is not saved anywhere)
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const N = 16384;
const r = 8;
const p = 1;

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
// Hide typed characters.
rl._writeToOutput = (text) => {
  if (text.includes("Password")) rl.output.write(text);
};

rl.question("Password (12+ characters): ", (password) => {
  rl.close();
  process.stdout.write("\n");
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N, r, p });
  console.log("\nAdd these two Environment Variables in Vercel (Production):\n");
  console.log(`ADMIN_PASSWORD_HASH=scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`);
  console.log(`ADMIN_SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
  console.log("\nKeep them secret. Changing ADMIN_SESSION_SECRET signs every device out.");
});
