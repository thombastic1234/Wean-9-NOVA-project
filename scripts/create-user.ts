import { ROLES, type Role } from "../src/lib/operations";
import { getRepository } from "../src/server/database";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const arg = (key: string) => args[args.indexOf(key) + 1];
async function passwordPrompt() {
  if (process.env.PASSCHECK_ACCOUNT_PASSWORD) return process.env.PASSCHECK_ACCOUNT_PASSWORD;
  if (!process.stdin.isTTY) throw new Error("Set PASSCHECK_ACCOUNT_PASSWORD or use an interactive terminal");
  process.stdout.write("Password (at least 12 characters): ");
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    function finish(error?: Error) { process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); error ? reject(error) : resolve(value); }
    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\u0003") { finish(new Error("Cancelled")); return; }
        if (char === "\r" || char === "\n") { finish(); return; }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1); else value += char;
      }
    }
    process.stdin.on("data", onData);
  });
}
try {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const role = (args.includes("--role") ? arg("--role") : await prompt.question(`Role (${ROLES.join(" / ")}): `)).toUpperCase() as Role;
  const email = args.includes("--email") ? arg("--email") : await prompt.question("Email: ");
  const name = args.includes("--name") ? arg("--name") : await prompt.question("Display name: ");
  prompt.close();
  if (!ROLES.includes(role)) throw new Error("Choose one of the five supported roles");
  const user = getRepository().createUser({ email, name, role, password: await passwordPrompt() });
  console.log(`Created ${user.role} account ${user.email}. Database: ${process.env.PASSCHECK_DATABASE_PATH || "data/passcheck.sqlite"}`);
} catch (error) { console.error(error instanceof Error ? error.message : "Could not create account"); process.exitCode = 1; }
