#!/usr/bin/env node
/**
 * Read-only. Live status for AWBs (tracking numbers) in one call.
 *   node tools/track.mjs <awb> [<awb> ...] [--scans]     --scans adds the full scan history
 */
import { loadConfig } from "../lib/config.mjs";
import { shiprocket, trackAwbs } from "../lib/orders.mjs";

const config = loadConfig();
const awbs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!awbs.length) { console.error("usage: node tools/track.mjs <awb> [<awb> ...] [--scans]"); process.exit(2); }
try {
  const sr = await shiprocket(config);
  console.log(JSON.stringify(await trackAwbs(sr, awbs, { scans: process.argv.includes("--scans") }), null, 1));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
}
