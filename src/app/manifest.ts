import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ghar Hisaab",
    short_name: "Ghar Hisaab",
    description: "Shared household expenses, payments and settlements for the family home.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7fb",
    theme_color: "#1b2340",
    categories: ["finance", "lifestyle", "productivity"],
    lang: "en",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Record a payment", short_name: "Pay", url: "/payments?new=1", icons: [{ src: "/icons/192", sizes: "192x192" }] },
      { name: "Add expense", short_name: "Expense", url: "/expenses?new=1", icons: [{ src: "/icons/192", sizes: "192x192" }] },
      { name: "Review payments", short_name: "Review", url: "/payments?status=pending", icons: [{ src: "/icons/192", sizes: "192x192" }] },
    ],
  };
}
