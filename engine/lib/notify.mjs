// Sends the run summary to wherever the team reads messages.
// Webhook URLs and bot tokens live in .env, never in config.json.
import { execFile } from "node:child_process";

const LIMITS = { slack: 3800, googlechat: 3800, discord: 1900, telegram: 3900 };

export async function sendMessage(config, text) {
  const type = config.notify?.type ?? "none";
  if (type === "none") return desktopAlert(`${config.brandName} support`, text.split("\n").slice(0, 2).join(" "));
  const parts = split(text, LIMITS[type] ?? 3800);
  for (const part of parts) await sendOne(type, part);
}

async function sendOne(type, text) {
  const env = process.env;
  const post = async (url, body) => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
        if (r.ok) return;
        lastErr = new Error(`${type} returned HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      } catch (e) { lastErr = e; }
      await new Promise((res) => setTimeout(res, 3000));
    }
    throw lastErr;
  };
  switch (type) {
    case "slack":
      return post(need(env.SLACK_WEBHOOK_URL, "SLACK_WEBHOOK_URL"), { text });
    case "googlechat":
      return post(need(env.GOOGLE_CHAT_WEBHOOK_URL, "GOOGLE_CHAT_WEBHOOK_URL"), { text });
    case "discord":
      return post(need(env.DISCORD_WEBHOOK_URL, "DISCORD_WEBHOOK_URL"), { content: text.replace(/\*/g, "**") });
    case "telegram":
      return post(`https://api.telegram.org/bot${need(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN")}/sendMessage`, {
        chat_id: need(env.TELEGRAM_CHAT_ID, "TELEGRAM_CHAT_ID"),
        text: text.replace(/\*/g, ""),
      });
    default:
      throw new Error(`Unknown notify.type "${type}" (use slack, googlechat, discord, telegram or none)`);
  }
}

/** Split on paragraph boundaries, never mid-sentence. */
function split(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if ((cur + "\n\n" + para).length > max && cur) { out.push(cur); cur = para; }
    else cur = cur ? `${cur}\n\n${para}` : para;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) out.push(cur);
  return out;
}

function need(v, name) {
  if (!v) throw new Error(`${name} missing in engine/.env`);
  return v;
}

/** A pop-up on this computer (macOS only; silently skipped elsewhere). */
export function desktopAlert(title, message) {
  if (process.platform !== "darwin") return;
  const safe = (s) => String(s).replace(/["\\]/g, "'").slice(0, 180);
  execFile("osascript", ["-e", `display notification "${safe(message)}" with title "${safe(title)}"`], () => {});
}
