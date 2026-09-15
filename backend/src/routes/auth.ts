import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";

const router = Router();

router.post("/registro", async (req: Request, res: Response): Promise<void> => {
  const { nombre, email, contrasena } = req.body;

  if (!nombre || !email || !contrasena) {
    res.status(400).json({ error: "Nombre, email y contraseña son requeridos" });
    return;
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    res.status(409).json({ error: "El email ya está registrado" });
    return;
  }

  const contrasenaHash = await bcrypt.hash(contrasena, 10);

  const usuario = await prisma.usuario.create({
    data: { nombre, email, contrasenaHash },
  });

  await prisma.registroSesion.create({
    data: { accion: "REGISTRO", usuarioId: usuario.id },
  });

  res.status(201).json({
    mensaje: "Usuario registrado exitosamente",
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email },
  });
});

router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { email, contrasena } = req.body;

  if (!email || !contrasena) {
    res.status(400).json({ error: "Email y contraseña son requeridos" });
    return;
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }

  const valido = await bcrypt.compare(contrasena, usuario.contrasenaHash);
  if (!valido) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }

  const token = jwt.sign({ usuarioId: usuario.id }, process.env.JWT_SECRET!, {
    expiresIn: "24h",
  });

  await prisma.registroSesion.create({
    data: { accion: "INICIO_SESION", usuarioId: usuario.id },
  });

  res.json({
    token,
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email },
  });
});

export default router;
