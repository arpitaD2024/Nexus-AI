import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  app.use(express.json());

  // In-memory store for demo
  let workflows: any[] = [];
  let logs: any[] = [
    { id: 'boot', timestamp: new Date().toISOString(), message: "SYSTEM: Nexus Core Initialized. All agent nodes online." },
    { id: 'wait', timestamp: new Date().toISOString(), message: "SYSTEM: Waiting for task input..." }
  ];

  // WebSocket handling
  const clients = new Set<WebSocket>();
  wss.on("connection", (ws) => {
    clients.add(ws);
    // Send initial state
    ws.send(JSON.stringify({ type: "INIT", workflows, logs }));
    
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        // Broadcast to all other clients
        clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
          }
        });
      } catch (e) {
        console.error("WS Message Error:", e);
      }
    });

    ws.on("close", () => clients.delete(ws));
  });

  // API Routes
  app.get("/api/workflows", (req, res) => {
    res.json(workflows);
  });

  app.post("/api/workflows", (req, res) => {
    const newWorkflow = req.body;
    const index = workflows.findIndex(w => w.id === newWorkflow.id);
    if (index !== -1) {
      workflows[index] = newWorkflow;
    } else {
      workflows.push(newWorkflow);
    }
    // Broadcast update
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "WORKFLOW_UPDATE", workflow: newWorkflow }));
      }
    });
    res.json(newWorkflow);
  });

  app.get("/api/logs", (req, res) => {
    res.json(logs);
  });

  app.post("/api/logs", (req, res) => {
    const log = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      ...req.body
    };
    logs.push(log);
    // Broadcast pulse
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "SYSTEM_PULSE", log }));
      }
    });
    res.json({ success: true });
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

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
