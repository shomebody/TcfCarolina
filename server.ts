import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Proxy endpoint to bypass CORS for scraping
  app.get("/api/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      console.log(`Proxying request to: ${targetUrl}`);
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'TopChefFantasyLeagueBot/1.1 (https://ais-pre-2ujt7kexusvm2mwfd33joa-256349775206.us-east1.run.app; contact: GarrettLMiller@gmail.com) node-fetch/1.0',
          'Accept': 'application/json, text/plain, */*'
        }
      });
      
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      
      const text = await response.text();
      
      if (!response.ok) {
        console.error(`Target returned error ${response.status}: ${text.substring(0, 200)}`);
        return res.status(response.status).send(text);
      }
      
      res.send(text);
    } catch (error: any) {
      console.error("Proxy error:", error);
      res.status(500).json({ error: `Failed to fetch URL: ${error.message}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
