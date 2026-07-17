/**
 * Renders a menu (from scraper.buildMenu) as a WhatsApp text message.
 * Pure: no network, no filesystem, no credentials.
 */
function renderWhatsApp(menu) {
  let msg = `🍽 *Lunch Menu*\n📅 ${menu.date}\n`;

  if (menu.events && menu.events.length) {
    msg += `\n🎭 *What's On Around You Today*\n`;
    for (const group of menu.events) {
      msg += `\n_${group.venue}_\n${group.items.join("\n")}\n`;
    }
  }

  if (menu.onVacation) {
    msg += "\n😴 _The cafés look closed for the vacation — no menus have been updated this week._\n";
    return msg + renderErrors(menu.errors);
  }

  if (!menu.sections.length) {
    msg += "\nNo menu items found for today.";
    return msg + renderErrors(menu.errors);
  }

  if (menu.pun) msg += `💬 _${menu.pun}_\n`;

  for (const section of menu.sections) {
    const staleNote = section.stale ? "\n_⚠️ not updated this week_" : "";
    msg += `\n*--- ${section.name} ---*\n${section.info}${staleNote}\n${section.items.join("\n")}\n`;
  }

  return msg + renderErrors(menu.errors);
}

function renderErrors(errors = []) {
  if (!errors.length) return "";
  const names = errors.map((e) => e.name).join(", ");
  return `\n⚠️ _Couldn't reach: ${names}_\n`;
}

module.exports = { renderWhatsApp };
