import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        muted: "var(--muted)",
        border: "var(--border)",
        text: "var(--text)",
        subtle: "var(--subtle)",
        primary: "var(--primary)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)"
      },
      boxShadow: {
        glow: "0 24px 60px -24px rgba(79, 70, 229, 0.45)"
      },
      backgroundImage: {
        hero:
          "radial-gradient(circle at top left, rgba(99,102,241,0.18), transparent 32%), radial-gradient(circle at bottom right, rgba(251,191,36,0.14), transparent 24%)"
      }
    }
  },
  plugins: []
} satisfies Config;
