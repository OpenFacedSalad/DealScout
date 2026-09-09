import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { resolveLocation, getCityFromCoordinates, getCircularsForLocation, compareDealsWithAI } from "./server/geminiService";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Resolve location (Coords -> City/State/Zip OR Zip/Query -> Coords/City/State)
  app.post("/api/location/resolve", async (req, res) => {
    try {
      const { lat, lng, query } = req.body;
      const location = await resolveLocation(
        typeof lat === "number" ? lat : undefined,
        typeof lng === "number" ? lng : undefined,
        typeof query === "string" ? query : undefined
      );
      res.json(location);
    } catch (err: any) {
      console.error("Location resolve error:", err);
      res.status(500).json({ error: err.message || "Failed to resolve location" });
    }
  });

  // Reverse Geocoding API: Coordinates -> City/State
  app.post("/api/location/geocode", async (req, res) => {
    try {
      const { lat, lng } = req.body;
      if (typeof lat !== "number" || typeof lng !== "number") {
        return res.status(400).json({ error: "lat and lng must be numbers" });
      }
      const location = await getCityFromCoordinates(lat, lng);
      res.json(location);
    } catch (err: any) {
      console.error("Geocoding error:", err);
      res.status(500).json({ error: err.message || "Failed to geocode location" });
    }
  });

  // Fetch local stores and circulars within radius
  app.post("/api/circulars/nearby", async (req, res) => {
    try {
      const {
        lat = 40.2234,
        lng = -77.0016,
        city = "Mechanicsburg",
        state = "PA",
        zipCode,
        radiusMiles = 10,
      } = req.body;

      const data = await getCircularsForLocation(
        Number(lat),
        Number(lng),
        city,
        state,
        zipCode,
        Number(radiusMiles) || 10
      );
      res.json(data);
    } catch (err: any) {
      console.error("Circulars fetch error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch circulars" });
    }
  });

  // Compare similar deals
  app.post("/api/compare/deals", async (req, res) => {
    try {
      const { productGroupName, deals } = req.body;
      if (!deals || !Array.isArray(deals) || deals.length === 0) {
        return res.status(400).json({ error: "Deals array is required" });
      }
      const comparison = await compareDealsWithAI(productGroupName || "Grocery Item", deals);
      res.json(comparison);
    } catch (err: any) {
      console.error("Comparison error:", err);
      res.status(500).json({ error: err.message || "Failed to compare deals" });
    }
  });

  // Vite middleware in dev mode / Static files in prod mode
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Grocery Circulars server running on port ${PORT}`);
  });
}

startServer();
