/**
 * Single source of truth for all brand-facing strings and theming.
 * Rebranding the product = editing this file only. Nothing else hardcodes a name.
 */
export const brand = {
  name: "Rylee's Hut",
  legalName: "Rylee's Hut Rapid Community Response Team",
  tagline: "Rapid community response — dispatched, tracked, and paid from one place.",
  domain: "example.com",
  supportEmail: "support@example.com",

  // Our twist vs. the incumbents: an AI job assistant baked into every surface.
  differentiator: "AI Job Assistant",

  theme: {
    primary: "#0F62FE",
    accent: "#12B886",
    surface: "#0B0F14",
    text: "#E6EDF3",
    radius: "12px",
    font: "'Inter', system-ui, sans-serif",
  },

  // Plan display names. Internal plan *keys* are stable and never renamed.
  planLabels: {
    starter: "Starter",
    pro: "Pro",
    premium: "Premium",
  },
} as const;

export type Brand = typeof brand;
