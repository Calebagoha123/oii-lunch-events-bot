/**
 * Renders a menu (from scraper.buildMenu) as an Adaptive Card payload for a
 * Microsoft Teams Power Automate workflow webhook.
 * Pure: no network, no filesystem, no credentials.
 */

/**
 * The menu fetchers emit WhatsApp-flavoured markup (single-asterisk bold).
 * Adaptive Card TextBlocks use CommonMark, where bold is double-asterisk.
 *
 * This is a stopgap: the fetchers should eventually return structured items and
 * let each renderer decide on emphasis. Until then, translate here.
 */
function whatsappMarkupToMarkdown(line) {
  return line.replace(/(^|\s)\*(\S(?:[^*\n]*\S)?)\*(?=\s|$|[.,!?])/g, "$1**$2**");
}

function textBlock(text, extra = {}) {
  return { type: "TextBlock", text, wrap: true, ...extra };
}

function renderTeams(menu) {
  const body = [
    textBlock("🍽 Lunch Menu", { size: "Large", weight: "Bolder" }),
    textBlock(`📅 ${menu.date}`, { isSubtle: true, spacing: "None" }),
  ];

  if (menu.events && menu.events.length) {
    body.push(
      textBlock("🎭 What's On Around You Today", {
        size: "Medium",
        weight: "Bolder",
        separator: true,
        spacing: "Medium",
      }),
    );
    for (const group of menu.events) {
      body.push(
        textBlock(group.venue, { weight: "Bolder", spacing: "Small" }),
      );
      body.push(
        textBlock(group.items.map(whatsappMarkupToMarkdown).join("\n\n"), {
          spacing: "None",
        }),
      );
    }
  }

  if (menu.onVacation) {
    body.push(
      textBlock(
        "😴 The cafés look closed for the vacation — no menus have been updated this week.",
        { wrap: true, spacing: "Medium" },
      ),
    );
  } else if (!menu.sections.length) {
    body.push(textBlock("No menu items found for today."));
  } else {
    if (menu.pun) {
      body.push(textBlock(`_${menu.pun}_`, { isSubtle: true, spacing: "Small" }));
    }

    for (const section of menu.sections) {
      body.push(
        textBlock(section.name, {
          size: "Medium",
          weight: "Bolder",
          separator: true,
          spacing: "Medium",
        }),
      );
      const info = section.stale
        ? `${section.info}  ·  ⚠️ not updated this week`
        : section.info;
      body.push(textBlock(info, { isSubtle: true, spacing: "None" }));
      body.push(
        textBlock(section.items.map(whatsappMarkupToMarkdown).join("\n\n"), {
          spacing: "Small",
        }),
      );
    }
  }

  if (menu.errors.length) {
    body.push(
      textBlock(
        `⚠️ Couldn't reach: ${menu.errors.map((e) => e.name).join(", ")}`,
        { color: "Attention", separator: true, spacing: "Medium" },
      ),
    );
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
        },
      },
    ],
  };
}

module.exports = { renderTeams, whatsappMarkupToMarkdown };
