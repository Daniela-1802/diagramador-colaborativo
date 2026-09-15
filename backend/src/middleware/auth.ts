import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  usuarioId?: string;
}

export function autenticarJWT(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token de autenticación requerido" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { usuarioId: string };
    req.usuarioId = decoded.usuarioId;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}
