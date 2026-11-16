// Turns the run's report JSON into the short message the owner reads in chat.
// Plain text with *bold* (Slack and Google Chat both render single-asterisk bold).
export function summaryText(config, report, { dry = false } = {}) {
  const c = report.counts ?? {};
  const day = new Date().toLocaleDateString("en-GB", { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short" });
  const lines = [];
  lines.push(`📬 *${config.brandName} support${dry ? " (DRY RUN, nothing sent)" : ""}: ${day}*`);
  lines.push("");
  const sentWord = config.mode === "drafts" ? "" : `${c.sent ?? 0} replied · `;
  lines.push(`${sentWord}${c.drafts ?? 0} drafts (${c.readFirst ?? 0} need you) · ${c.awaitingReply ?? 0} customers were waiting`);
  if (c.backlogRemaining) lines.push(`${c.backlogRemaining} more waiting, handled next run (oldest first)`);
  if (c.autoStaged) lines.push(`🔁 ${c.autoStaged} replacement parcel(s) arranged`);

  const readFirst = report.readFirst ?? [];
  if (readFirst.length) {
    lines.push("", `*Need you (drafts labelled "${config.labels.readFirst.name}")*`);
    for (const r of readFirst.slice(0, 15)) lines.push(`• ${r.order ? `#${r.order} ` : ""}${r.customer ?? ""}: ${r.reason ?? ""}`);
    if (readFirst.length > 15) lines.push(`• …and ${readFirst.length - 15} more in Gmail`);
  }
  const sent = report.sent ?? [];
  if (sent.length) {
    lines.push("", `*Replied (${sent.length})*`);
    for (const s of sent.slice(0, 12)) lines.push(`• ${s.order ? `#${s.order} ` : ""}${s.customer ?? ""}: ${s.what ?? s.template ?? ""}`);
    if (sent.length > 12) lines.push(`• …and ${sent.length - 12} more (Gmail → Sent)`);
  }
  const ready = report.ready ?? [];
  if (config.mode === "drafts" && ready.length) {
    lines.push("", `*Ready to send (${ready.length}), check and hit send*`);
    for (const s of ready.slice(0, 12)) lines.push(`• ${s.order ? `#${s.order} ` : ""}${s.customer ?? ""}: ${s.what ?? ""}`);
  }
  const staged = report.autoStagedList ?? [];
  if (staged.length) {
    lines.push("", "*Replacements arranged*");
    for (const s of staged) lines.push(`• #${s.order} ${s.customer ?? ""}: ${s.items ?? ""}${s.booked ? ` (booked ${s.booked})` : ""}`);
  }
  const flags = report.flags ?? [];
  if (flags.length) {
    lines.push("", "*Heads up*");
    for (const f of flags.slice(0, 10)) lines.push(`⚠️ ${f}`);
  }
  return lines.join("\n");
}

export function failureText(config, kind, detail = "") {
  const head = `🚨 *${config.brandName} support run did not finish*`;
  const why = {
    auth: "Claude Code's login on this computer expired. Fix: open Claude Code on this computer once (it refreshes the login), then say \"run support now\".",
    timeout: `The run took longer than ${config.maxRunMinutes} minutes and was stopped. Nothing is lost: unanswered customers are picked up next run.`,
    noreport: "Claude finished but wrote no report, so nothing can be confirmed. Check Gmail drafts/sent, then ask Claude: \"why did the support run fail?\"",
    crash: "The run crashed before finishing.",
    locked: "Another support run was still going, so this one was skipped.",
  }[kind] ?? kind;
  return `${head}\n\n${why}${detail ? `\n\nLast lines:\n${detail.slice(-600)}` : ""}`;
}
