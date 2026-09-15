import { Router, Response } from "express";
import { RolColaborador } from "@prisma/client";
import prisma from "../lib/prisma";
import { autenticarJWT, AuthRequest } from "../middleware/auth";

const router = Router();

router.use(autenticarJWT);

router.post("/", async (req: AuthRequest, res: Response): Promise<void> => {
  const { tipo, titulo } = req.body;

  if (!tipo || !["clases", "ER"].includes(tipo)) {
    res.status(400).json({ error: "Tipo debe ser 'clases' o 'ER'" });
    return;
  }

  const tipoDb = tipo === "clases" ? "CLASES" : "ENTIDAD_RELACION";

  const diagrama = await prisma.diagrama.create({
    data: {
      titulo: titulo || "Diagrama sin título",
      tipo: tipoDb,
      colaboraciones: {
        create: {
          usuarioId: req.usuarioId!,
          rol: RolColaborador.PROPIETARIO,
        },
      },
    },
    include: { colaboraciones: true },
  });

  res.status(201).json(diagrama);
});

router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  const diagramas = await prisma.diagrama.findMany({
    where: {
      colaboraciones: {
        some: { usuarioId: req.usuarioId },
      },
    },
    include: {
      colaboraciones: {
        select: { rol: true, usuario: { select: { id: true, nombre: true } } },
      },
    },
    orderBy: { fechaModificacion: "desc" },
  });

  res.json(diagramas);
});

router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const colaboracion = await prisma.colaboracion.findUnique({
    where: {
      usuarioId_diagramaId: {
        usuarioId: req.usuarioId!,
        diagramaId: id,
      },
    },
  });

  if (!colaboracion) {
    res.status(403).json({ error: "No tienes acceso a este diagrama" });
    return;
  }

  const diagrama = await prisma.diagrama.findUnique({
    where: { id },
    include: {
      colaboraciones: {
        select: {
          rol: true,
          fechaInvitacion: true,
          usuario: { select: { id: true, nombre: true, email: true } },
        },
      },
      elementos: {
        include: { atributos: true },
      },
    },
  });

  res.json({ ...diagrama, miRol: colaboracion.rol });
});

router.get("/:id/colaboradores", async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const diagrama = await prisma.diagrama.findUnique({ where: { id } });
  if (!diagrama) {
    res.status(404).json({ error: "Diagrama no encontrado" });
    return;
  }

  const miColaboracion = await prisma.colaboracion.findUnique({
    where: { usuarioId_diagramaId: { usuarioId: req.usuarioId!, diagramaId: id } },
  });

  if (!miColaboracion) {
    res.status(403).json({ error: "No tienes acceso a este diagrama" });
    return;
  }

  const colaboradores = await prisma.colaboracion.findMany({
    where: { diagramaId: id },
    include: { usuario: { select: { id: true, nombre: true, email: true } } },
    orderBy: { fechaInvitacion: "asc" },
  });

  res.json(
    colaboradores.map((c) => ({
      usuarioId: c.usuario.id,
      nombre: c.usuario.nombre,
      email: c.usuario.email,
      rol: c.rol,
      fechaInvitacion: c.fechaInvitacion,
    }))
  );
});

router.post("/:id/invitar", async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { email } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    res.status(400).json({ error: "Email inválido" });
    return;
  }

  const diagrama = await prisma.diagrama.findUnique({ where: { id } });
  if (!diagrama) {
    res.status(404).json({ error: "Diagrama no encontrado" });
    return;
  }

  const miColaboracion = await prisma.colaboracion.findUnique({
    where: { usuarioId_diagramaId: { usuarioId: req.usuarioId!, diagramaId: id } },
  });

  if (!miColaboracion) {
    res.status(403).json({ error: "No tienes acceso a este diagrama" });
    return;
  }

  if (miColaboracion.rol !== RolColaborador.PROPIETARIO) {
    res.status(403).json({ error: "Solo el propietario puede invitar colaboradores" });
    return;
  }

  const usuarioInvitado = await prisma.usuario.findUnique({ where: { email } });
  if (!usuarioInvitado) {
    res.status(404).json({ error: "El usuario con ese email no está registrado" });
    return;
  }

  if (usuarioInvitado.id === req.usuarioId) {
    res.status(400).json({ error: "Ya eres colaborador de este diagrama" });
    return;
  }

  const colaboracionExistente = await prisma.colaboracion.findUnique({
    where: { usuarioId_diagramaId: { usuarioId: usuarioInvitado.id, diagramaId: id } },
  });

  if (colaboracionExistente) {
    res.status(200).json({
      mensaje: "El usuario ya era colaborador de este diagrama",
      colaboracion: {
        usuarioId: usuarioInvitado.id,
        nombre: usuarioInvitado.nombre,
        email: usuarioInvitado.email,
        rol: colaboracionExistente.rol,
        fechaInvitacion: colaboracionExistente.fechaInvitacion,
      },
    });
    return;
  }

  const nuevaColaboracion = await prisma.colaboracion.create({
    data: {
      usuarioId: usuarioInvitado.id,
      diagramaId: id,
      rol: RolColaborador.COLABORADOR,
    },
  });

  res.status(201).json({
    mensaje: "Colaborador agregado exitosamente",
    colaboracion: {
      usuarioId: usuarioInvitado.id,
      nombre: usuarioInvitado.nombre,
      email: usuarioInvitado.email,
      rol: nuevaColaboracion.rol,
      fechaInvitacion: nuevaColaboracion.fechaInvitacion,
    },
  });
});

export default router;
