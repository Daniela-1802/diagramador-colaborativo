import { Router, Response } from "express";
import { RolColaborador } from "@prisma/client";
import { create } from "xmlbuilder2";
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

router.delete("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const diagrama = await prisma.diagrama.findUnique({ where: { id } });
  if (!diagrama) {
    res.status(404).json({ error: "Diagrama no encontrado" });
    return;
  }

  const colaboracion = await prisma.colaboracion.findUnique({
    where: { usuarioId_diagramaId: { usuarioId: req.usuarioId!, diagramaId: id } },
  });

  if (!colaboracion) {
    res.status(403).json({ error: "No tienes acceso a este diagrama" });
    return;
  }

  if (colaboracion.rol !== RolColaborador.PROPIETARIO) {
    res.status(403).json({ error: "Solo el propietario puede eliminar el diagrama" });
    return;
  }

  await prisma.$transaction([
    prisma.relacionUML.deleteMany({
      where: {
        OR: [
          { origen: { diagramaId: id } },
          { destino: { diagramaId: id } },
        ],
      },
    }),
    prisma.atributo.deleteMany({
      where: { elementoDiagrama: { diagramaId: id } },
    }),
    prisma.colaboracion.deleteMany({ where: { diagramaId: id } }),
    prisma.elementoDiagrama.deleteMany({ where: { diagramaId: id } }),
    prisma.diagrama.delete({ where: { id } }),
    prisma.registroSesion.create({
      data: {
        usuarioId: req.usuarioId!,
        accion: `Eliminó el diagrama "${diagrama.titulo}"`,
      },
    }),
  ]);

  res.status(200).json({ mensaje: "Diagrama eliminado exitosamente" });
});

router.get("/:id/exportar-xmi", async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const diagrama = await prisma.diagrama.findUnique({ where: { id } });
  if (!diagrama) {
    res.status(404).json({ error: "Diagrama no encontrado" });
    return;
  }

  const colaboracion = await prisma.colaboracion.findUnique({
    where: { usuarioId_diagramaId: { usuarioId: req.usuarioId!, diagramaId: id } },
  });
  if (!colaboracion) {
    res.status(403).json({ error: "No tienes acceso a este diagrama" });
    return;
  }

  const [elementos, relaciones] = await Promise.all([
    prisma.elementoDiagrama.findMany({
      where: { diagramaId: id },
      include: { atributos: true },
    }),
    prisma.relacionUML.findMany({
      where: {
        OR: [
          { origen: { diagramaId: id } },
          { destino: { diagramaId: id } },
        ],
      },
      include: { origen: true, destino: true },
    }),
  ]);

  const tipoPrimitivo = (tipoDato: string) => ({
    string: "String",
    int: "Integer",
    boolean: "Boolean",
    Date: "Date",
    decimal: "Real",
  }[tipoDato] || tipoDato);

  const multiplicidad = (valor: string | null) => {
    if (valor === "1") return { min: "1", max: "1" };
    if (valor === "*") return { min: "0", max: "*" };
    if (valor === "0..1") return { min: "0", max: "1" };
    if (valor === "1..*") return { min: "1", max: "*" };
    if (valor === "0..*") return { min: "0", max: "*" };
    const rango = valor?.match(/^(\d+)\.\.(\d+|\*)$/);
    if (rango) return { min: rango[1], max: rango[2] };
    return { min: "0", max: "*" };
  };

  const document = create({ version: "1.0", encoding: "UTF-8" });
  const xmi = document.ele("xmi:XMI", {
    "xmi:version": "2.5.1",
    "xmlns:xmi": "http://www.omg.org/spec/XMI/20131001",
    "xmlns:uml": "http://www.omg.org/spec/UML/20131001",
  });
  xmi.ele("xmi:Documentation", {
    exporter: "Diagramador Colaborativo UML",
    exporterVersion: "1.0",
  }).up();

  const model = xmi.ele("uml:Model", {
    "xmi:type": "uml:Model",
    name: diagrama.titulo,
    "xmi:id": `model_${diagrama.id}`,
  });
  const paquete = model.ele("packagedElement", {
    "xmi:type": "uml:Package",
    "xmi:id": `pkg_${diagrama.id}`,
    name: diagrama.titulo,
  });

  elementos.forEach((elemento) => {
    const clase = paquete.ele("packagedElement", {
      "xmi:type": "uml:Class",
      "xmi:id": elemento.id,
      name: elemento.nombre,
    });
    elemento.atributos.forEach((atributo) => {
      const ownedAttribute = clase.ele("ownedAttribute", {
        "xmi:type": "uml:Property",
        "xmi:id": atributo.id,
        name: atributo.nombre,
        visibility: atributo.visibilidad === "+" ? "public" : atributo.visibilidad === "-" ? "private" : atributo.visibilidad === "#" ? "protected" : "public",
      });
      ownedAttribute.ele("type", {
        "xmi:type": "uml:PrimitiveType",
        href: `http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#${tipoPrimitivo(atributo.tipoDato)}`,
      }).up();
      ownedAttribute.up();
    });
    clase.up();
  });

  relaciones.forEach((relacion) => {
    if (relacion.tipo === "HERENCIA") {
      paquete.ele("packagedElement", {
        "xmi:type": "uml:Generalization",
        "xmi:id": relacion.id,
        general: relacion.destinoId,
        specific: relacion.origenId,
      }).up();
      return;
    }

    const association = paquete.ele("packagedElement", {
      "xmi:type": "uml:Association",
      "xmi:id": relacion.id,
      name: `${relacion.origen.nombre}_${relacion.destino.nombre}`,
    });
    association.ele("memberEnd", { "xmi:idref": `${relacion.id}_end1` }).up();
    association.ele("memberEnd", { "xmi:idref": `${relacion.id}_end2` }).up();
    const aggregation = relacion.tipo === "COMPOSICION" ? "composite" : relacion.tipo === "AGREGACION" ? "shared" : undefined;
    [
      { id: relacion.origenId, multiplicidad: relacion.multiplicidadOrigen, aggregation },
      { id: relacion.destinoId, multiplicidad: relacion.multiplicidadDestino, aggregation: undefined },
    ].forEach((extremo, index) => {
      const rango = multiplicidad(extremo.multiplicidad);
      const ownedEnd = association.ele("ownedEnd", {
        "xmi:type": "uml:Property",
        "xmi:id": `${relacion.id}_end${index + 1}`,
        type: extremo.id,
        association: relacion.id,
        ...(extremo.aggregation ? { aggregation: extremo.aggregation } : {}),
      });
      ownedEnd.ele("lowerValue", { "xmi:type": "uml:LiteralInteger", value: rango.min }).up();
      ownedEnd.ele("upperValue", { "xmi:type": "uml:LiteralUnlimitedNatural", value: rango.max }).up();
      ownedEnd.up();
    });
    association.up();
  });

  const xml = document.end({ prettyPrint: true });
  await prisma.registroSesion.create({
    data: { usuarioId: req.usuarioId!, accion: "Exportó diagrama a XMI" },
  });

  const nombreArchivo = (diagrama.titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "diagrama") + ".xmi";
  res.type("application/xml");
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
  res.send(xml);
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
