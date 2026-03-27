import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.svg", "icon.svg"],
            manifest: {
                name: "Bhishi Admin",
                short_name: "Bhishi",
                description: "Admin-only rotating savings group management progressive web app.",
                theme_color: "#4F46E5",
                background_color: "#FFF7ED",
                display: "standalone",
                start_url: "/",
                icons: [
                    { src: "/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
                    { src: "/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }
                ]
            },
            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
                navigateFallback: "/index.html",
                cleanupOutdatedCaches: true
            }
        })
    ]
});
