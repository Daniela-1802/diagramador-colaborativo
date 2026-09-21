import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import authRoutes from "./routes/auth";
import diagramasRoutes from "./routes/diagramas";
import { autenticarJWT, AuthRequest } from "./middleware/auth";
import prisma from "./lib/prisma";
import { configurarSocket } from "./socket";

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.set("io", io);

configurarSocket(io);

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/diagramas", diagramasRoutes);

app.get("/api/yo", autenticarJWT, async (req: AuthRequest, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuarioId },
    select: { id: true, nombre: true, email: true },
  });
  res.json(usuario);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

httpServer.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
