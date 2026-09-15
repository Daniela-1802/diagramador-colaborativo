import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import diagramasRoutes from "./routes/diagramas";
import { autenticarJWT, AuthRequest } from "./middleware/auth";
import prisma from "./lib/prisma";

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
