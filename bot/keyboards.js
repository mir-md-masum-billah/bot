import { Markup } from "telegraf";

export const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📢 Promote", "menu_promote")],
    [Markup.button.callback("💰 Earn", "menu_earn")],
    [Markup.button.callback("🗂 My Cabinet", "menu_cabinet")],
    [Markup.button.callback("💳 Balance", "menu_balance")],
  ]);

// Persistent bottom keyboard (always visible under the message box),
// matching the PR GRAM-style layout.
export const replyMainMenu = () =>
  Markup.keyboard([
    ["💰 Earnings", "📢 Promote"],
    ["📤 Checks", "👤 My Cabinet"],
    ["✅ Subscription Check", "📊 Our Bots and Statistics"],
    ["🔗 Useful Links", "ℹ️ Instruction"],
  ]).resize();

export const promoteTypeMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📢 Channel", "promote_channel")],
    [Markup.button.callback("👥 Group", "promote_group")],
    [Markup.button.callback("👀 Views", "promote_views")],
    [Markup.button.callback("🤖 Bot", "promote_bot")],
    [Markup.button.callback("⚡️ Premium Boost", "promote_boost")],
    [Markup.button.callback("⬅️ Back", "menu_main")],
  ]);

export const earnTypeMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("👥 Subscribe (Channel/Group)", "earn_sub")],
    [Markup.button.callback("👀 Views", "earn_views")],
    [Markup.button.callback("🤖 Bots", "earn_bot")],
    [Markup.button.callback("⬅️ Back", "menu_main")],
  ]);

export const subscriberCountMenu = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("50", "count_50"),
      Markup.button.callback("100", "count_100"),
      Markup.button.callback("250", "count_250"),
    ],
    [
      Markup.button.callback("500", "count_500"),
      Markup.button.callback("1000", "count_1000"),
    ],
    [Markup.button.callback("✏️ Custom amount", "count_custom")],
    [Markup.button.callback("⬅️ Back", "menu_promote")],
  ]);

export const cabinetMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📋 My Tasks", "cabinet_tasks")],
    [Markup.button.callback("⬅️ Back", "menu_main")],
  ]);

export const taskManageMenu = (taskId, status) =>
  Markup.inlineKeyboard([
    [
      status === "active"
        ? Markup.button.callback("⏸ Pause", `task_pause_${taskId}`)
        : Markup.button.callback("▶️ Resume", `task_resume_${taskId}`),
      Markup.button.callback("🗑 Delete", `task_delete_${taskId}`),
    ],
    [Markup.button.callback("⬅️ Back to list", "cabinet_tasks")],
  ]);

export const earnActionMenu = (taskId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ I've done it — Check", `verify_${taskId}`)],
    [Markup.button.callback("⏭ Skip", "earn_sub")],
  ]);
