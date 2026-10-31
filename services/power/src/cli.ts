import { connect, databaseUrls } from "@venom/db";
import { PowerError } from "./errors.ts";
import { createPower } from "./power.ts";

const usage = "Usage: pnpm power:grant <email> <units> [note]";
const [command, email, unitsText, ...noteWords] = process.argv.slice(2);
const units = Number(unitsText);

if (command !== "grant" || email === undefined || !Number.isSafeInteger(units) || units <= 0) {
  console.error(usage);
  process.exit(2);
}

const sql = connect(databaseUrls.app, { max: 1 });
try {
  const note = noteWords.join(" ").trim() || "Granted by the operator";
  const { status } = await createPower({ sql }).grant({ email, units, note });
  console.log(`Granted ${units} power to ${email}. Balance is now ${status.balance}.`);
} catch (error) {
  console.error(error instanceof PowerError ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
