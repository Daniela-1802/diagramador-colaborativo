import { Router, Response } from "express";
import { RolColaborador } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import multer from "multer";
import { Server } from "socket.io";
import { create } from "xmlbuilder2";
import prisma from "../lib/prisma";
import { autenticarJWT, AuthRequest } from "../middleware/auth";
import { interpretarImagenUML } from "../gemini";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const uploadImagen = multer({ storage: multer.memoryStorage() });

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

router.post("/:id/importar-xmi", upload.single("archivo"), async (req: AuthRequest, res: Response): Promise<void> => {
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
  if (colaboracion.rol !== RolColaborador.PROPIETARIO && colaboracion.rol !== RolColaborador.COLABORADOR) {
    res.status(403).json({ error: "No tienes permisos para importar en este diagrama" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Debes adjuntar un archivo XMI" });
    return;
  }

  const asArray = (value: unknown): Record<string, any>[] => {
    if (!value) return [];
    return Array.isArray(value) ? value as Record<string, any>[] : [value as Record<string, any>];
  };
  const atributo = (node: Record<string, any>, nombre: string) =>
    node[`@_${nombre}`];
  const atributoXmi = (node: Record<string, any>, nombre: string) =>
    node[`@_xmi:${nombre}`];
  const tipoElemento = (node: Record<string, any>) => atributoXmi(node, "type");
  const texto = (value: unknown) => value === undefined || value === null ? undefined : String(value);

  const xml = req.file.buffer.toString("utf8");
  const formato = xml.includes("omg.org/spec/UML/20131001")
    ? "PROPIO"
    : xml.includes("schema.omg.org/spec/UML/2.1")
      ? "EA"
      : "GENERICO";
  let contenido: Record<string, any>;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true });
    contenido = parser.parse(xml) as Record<string, any>;
  } catch {
    res.status(400).json({ error: "El archivo XMI no es válido" });
    return;
  }

  const raiz = contenido["xmi:XMI"] || contenido.XMI;
  const modelo = raiz?.["uml:Model"] || raiz?.Model;
  const buscarPaquete = (node: Record<string, any>): Record<string, any> | null => {
    for (const elemento of asArray(node?.packagedElement)) {
      if (tipoElemento(elemento) === "uml:Package") return elemento;
      const encontrado = buscarPaquete(elemento);
      if (encontrado) return encontrado;
    }
    return null;
  };
  const paquete = buscarPaquete(modelo);
  if (!paquete) {
    res.status(400).json({ error: "El XMI no contiene un paquete UML válido" });
    return;
  }

  const elementos = asArray(paquete.packagedElement);
  const clases = elementos.filter((elemento) => tipoElemento(elemento) === "uml:Class");
  const extension = raiz?.["xmi:Extension"] || raiz?.Extension || {};
  const primitivos = new Map<string, string>();
  const recolectarPrimitivos = (node: Record<string, any>) => {
    asArray(node?.packagedElement).forEach((elemento) => {
      if (tipoElemento(elemento) === "uml:PrimitiveType") {
        const id = texto(atributoXmi(elemento, "id"));
        const nombre = texto(atributo(elemento, "name"));
        if (id && nombre) primitivos.set(id, nombre);
      }
      recolectarPrimitivos(elemento);
    });
  };
  recolectarPrimitivos(extension?.primitivetypes || {});
  const mapaTipo = (node: Record<string, any>) => {
    const referencia = atributo(node, "href") || atributo(node, "idref");
    const nombre = String(referencia || "").split("#").pop() || "";
    const tipo = primitivos.get(nombre) || nombre;
    return ({ String: "string", string: "string", Integer: "int", int: "int", Boolean: "boolean", boolean: "boolean", Real: "decimal", decimal: "decimal", Date: "Date", date: "Date" } as Record<string, string>)[tipo] || "string";
  };
  const mapaVisibilidad = (visibility: unknown) =>
    ({ public: "+", private: "-", protected: "#" } as Record<string, string>)[String(visibility)] || "+";
  const mapaElementos = new Map<string, string>();
  const datosElementos: { originalId: string; nombre: string; atributos: { nombre: string; tipoDato: string; visibilidad: string }[]; posicionX: number; posicionY: number }[] = [];

  clases.forEach((clase) => {
    const originalId = String(atributoXmi(clase, "id") || "");
    if (!originalId) return;
    const atributos = asArray(clase.ownedAttribute).map((item) => ({
      nombre: String(atributo(item, "name") || "Atributo"),
      tipoDato: mapaTipo(asArray(item.type)[0] || {}),
      visibilidad: mapaVisibilidad(atributo(item, "visibility")),
    }));
    mapaElementos.set(originalId, "");
    datosElementos.push({ originalId, nombre: String(atributo(clase, "name") || "Clase importada"), atributos, posicionX: 100 + Math.random() * 400, posicionY: 100 + Math.random() * 400 });
  });

  const multiplicidad = (end: Record<string, any>) => {
    const lower = texto(atributo(asArray(end.lowerValue)[0] || {}, "value"));
    const upperRaw = texto(atributo(asArray(end.upperValue)[0] || {}, "value"));
    const upper = upperRaw === "-1" ? "*" : upperRaw;
    if (!lower || !upper) return "1..*";
    if (lower === "1" && upper === "1") return "1";
    if (lower === "1" && upper === "*") return "1..*";
    if (lower === "0" && upper === "1") return "0..1";
    if (lower === "0" && upper === "*") return "0..*";
    return `${lower}..${upper}`;
  };
  const multiplicidadEA = (tipo: Record<string, any>) => {
    const valor = texto(atributo(tipo, "multiplicity"));
    if (!valor) return "1..*";
    if (valor === "-1") return "0..*";
    if (/^\d+$/.test(valor)) return valor;
    if (/^\d+\.\.\d+$/.test(valor) || /^\d+\.\.\*$/.test(valor)) return valor;
    return "1..*";
  };
  const conectores = asArray(extension?.connectors?.connector);
  const conectorPorId = new Map(conectores.map((conector) => [texto(atributo(conector, "idref") || atributo(conector, "id")), conector]));
  const tipoConector = (conector: Record<string, any> | undefined) =>
    String(atributo(conector || {}, "type") || conector?.properties?.["@_ea_type"] || "");
  const relaciones = elementos.filter((elemento) =>
    tipoElemento(elemento) === "uml:Generalization" || (formato !== "EA" && tipoElemento(elemento) === "uml:Association")
  );
  const relacionesEALinks = formato === "EA"
    ? asArray(extension?.elements?.element).flatMap((elemento) => asArray(elemento.links?.Association).map((link) => ({
      id: texto(atributo(link, "id")),
      origenOriginal: texto(atributo(link, "start")),
      destinoOriginal: texto(atributo(link, "end")),
      conector: conectorPorId.get(texto(atributo(link, "id"))),
    })))
    : [];
  const relacionesEAGeneralizacion = formato === "EA"
    ? conectores.filter((conector) => tipoConector(conector).toLowerCase().includes("generalization")).map((conector) => ({
      id: texto(atributo(conector, "idref") || atributo(conector, "id")),
      origenOriginal: texto(atributo(asArray(conector.source)[0] || {}, "idref")),
      destinoOriginal: texto(atributo(asArray(conector.target)[0] || {}, "idref")),
      conector,
    }))
    : [];
  const relacionesEA = [...new Map(
    [...relacionesEALinks, ...relacionesEAGeneralizacion]
      .filter((relacion) => relacion.id)
      .map((relacion) => [relacion.id, relacion])
  ).values()];
  const emitidos: { elementos: any[]; atributos: any[]; relaciones: any[] } = { elementos: [], atributos: [], relaciones: [] };

  console.log("[importar-xmi] INICIO - formato detectado:", formato);
  try {
    await prisma.$transaction(async (tx) => {
      for (const datos of datosElementos) {
        const elemento = await tx.elementoDiagrama.create({
          data: {
            diagramaId: id,
            nombre: datos.nombre,
            tipo: "CLASE",
            posicionX: datos.posicionX,
            posicionY: datos.posicionY,
          },
          select: { id: true, nombre: true, tipo: true, posicionX: true, posicionY: true },
        });
        mapaElementos.set(datos.originalId, elemento.id);
        emitidos.elementos.push({ ...elemento, diagramaId: id, atributos: [] });
        for (const datoAtributo of datos.atributos) {
          const creado = await tx.atributo.create({
            data: { ...datoAtributo, elementoDiagramaId: elemento.id },
            select: { id: true, nombre: true, tipoDato: true, visibilidad: true },
          });
          emitidos.atributos.push({ ...creado, elementoId: elemento.id });
        }
      }

      for (const relacion of relaciones) {
        let origenOriginal: string | undefined;
        let destinoOriginal: string | undefined;
        let tipo = "ASOCIACION";
        let multiplicidadOrigen = "1..*";
        let multiplicidadDestino = "1..*";
        if (tipoElemento(relacion) === "uml:Generalization") {
          origenOriginal = texto(atributo(relacion, "specific"));
          destinoOriginal = texto(atributo(relacion, "general"));
          tipo = "HERENCIA";
        } else {
          const extremos = asArray(relacion.ownedEnd);
          if (extremos.length < 2) continue;
          origenOriginal = texto(atributo(extremos[0], "type"));
          destinoOriginal = texto(atributo(extremos[1], "type"));
          multiplicidadOrigen = multiplicidad(extremos[0]);
          multiplicidadDestino = multiplicidad(extremos[1]);
          const aggregation = atributo(extremos[0], "aggregation");
          tipo = aggregation === "composite" ? "COMPOSICION" : aggregation === "shared" ? "AGREGACION" : "ASOCIACION";
        }
        const origenId = origenOriginal ? mapaElementos.get(origenOriginal) : undefined;
        const destinoId = destinoOriginal ? mapaElementos.get(destinoOriginal) : undefined;
        if (!origenId || !destinoId) {
          console.log("[importar-xmi] SKIP relación (sin origen/destino):", { origenOriginal, destinoOriginal, origenId, destinoId });
          continue;
        }
        const creada = await tx.relacionUML.create({
          data: { tipo, multiplicidadOrigen, multiplicidadDestino, origenId, destinoId },
          select: { id: true, tipo: true, multiplicidadOrigen: true, multiplicidadDestino: true, origenId: true, destinoId: true },
        });
        emitidos.relaciones.push(creada);
      }
      for (const relacion of relacionesEA) {
        if (!relacion.origenOriginal || !relacion.destinoOriginal) continue;
        const conector = relacion.conector;
        const source = asArray(conector?.source)[0] || {};
        const target = asArray(conector?.target)[0] || {};
        const sourceType = asArray(source.type)[0] || {};
        const targetType = asArray(target.type)[0] || {};
        if (tipoConector(conector).toLowerCase().includes("generalization")) {
          const creada = await tx.relacionUML.create({
            data: {
              tipo: "HERENCIA",
              multiplicidadOrigen: "1..*",
              multiplicidadDestino: "1..*",
              origenId: mapaElementos.get(relacion.origenOriginal)!,
              destinoId: mapaElementos.get(relacion.destinoOriginal)!,
            },
            select: { id: true, tipo: true, multiplicidadOrigen: true, multiplicidadDestino: true, origenId: true, destinoId: true },
          });
          emitidos.relaciones.push(creada);
          continue;
        }
        const origenId = mapaElementos.get(relacion.origenOriginal);
        const destinoId = mapaElementos.get(relacion.destinoOriginal);
        if (!origenId || !destinoId) {
          console.log("[importar-xmi] SKIP relación (sin origen/destino):", { origenOriginal: relacion.origenOriginal, destinoOriginal: relacion.destinoOriginal, origenId, destinoId });
          continue;
        }
        const aggregation = atributo(sourceType, "aggregation");
        const tipo = aggregation === "composite" ? "COMPOSICION" : aggregation === "shared" ? "AGREGACION" : "ASOCIACION";
        const creada = await tx.relacionUML.create({
          data: {
            tipo,
            multiplicidadOrigen: multiplicidadEA(sourceType),
            multiplicidadDestino: multiplicidadEA(targetType),
            origenId,
            destinoId,
          },
          select: { id: true, tipo: true, multiplicidadOrigen: true, multiplicidadDestino: true, origenId: true, destinoId: true },
        });
        emitidos.relaciones.push(creada);
      }
      await tx.registroSesion.create({
        data: { usuarioId: req.usuarioId!, accion: `Importó ${datosElementos.length} clases, ${emitidos.relaciones.length} relaciones desde XMI (${formato})` },
      });
    });
  } catch (error) {
    console.error("[importar-xmi] ERROR en transaction:", error);
    console.error("[importar-xmi] Stack:", (error as Error).stack);
    res.status(500).json({ error: "Error al importar el diagrama XMI" });
    return;
  }

  const io = req.app.get("io") as Server | undefined;
  const sala = `diagrama:${id}`;
  console.log("[importar-xmi] io disponible?", !!io);
  console.log("[importar-xmi] sala:", sala);
  console.log("[importar-xmi] elementos a emitir:", emitidos.elementos.length);
  console.log("[importar-xmi] atributos a emitir:", emitidos.atributos.length);
  console.log("[importar-xmi] relaciones a emitir:", emitidos.relaciones.length);
  emitidos.elementos.forEach((elemento) => {
    console.log("[importar-xmi] Emitiendo elemento:creado", elemento.id);
    io?.to(sala).emit("elemento:creado", elemento);
  });
  emitidos.atributos.forEach((atributoCreado) => {
    console.log("[importar-xmi] Emitiendo atributo:creado", atributoCreado.id);
    io?.to(sala).emit("atributo:creado", atributoCreado);
  });
  emitidos.relaciones.forEach((relacion) => {
    console.log("[importar-xmi] Emitiendo relacion:creada", relacion.id);
    io?.to(sala).emit("relacion:creada", relacion);
  });
  res.status(200).json({ clasesImportadas: datosElementos.length, relacionesImportadas: emitidos.relaciones.length, errores: [] });
});

router.post("/:id/importar-imagen", uploadImagen.single("imagen"), async (req: AuthRequest, res: Response): Promise<void> => {
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
  if (colaboracion.rol !== RolColaborador.PROPIETARIO && colaboracion.rol !== RolColaborador.COLABORADOR) {
    res.status(403).json({ error: "No tienes permisos para importar en este diagrama" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Debes adjuntar una imagen" });
    return;
  }
  const tiposImagenPermitidos = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!tiposImagenPermitidos.has(req.file.mimetype)) {
    res.status(400).json({ error: "La imagen debe ser PNG, JPG, JPEG o WebP" });
    return;
  }
  if (req.file.size >= 5 * 1024 * 1024) {
    res.status(400).json({ error: "La imagen debe pesar menos de 5 MB" });
    return;
  }

  let interpretacion;
  try {
    interpretacion = await interpretarImagenUML(req.file.buffer, req.file.mimetype);
  } catch (error) {
    console.error("[importar-imagen] Error al analizar imagen:", error);
    res.status(500).json({ error: "No se pudo analizar la imagen UML" });
    return;
  }

  const emitidos: { elementos: any[]; atributos: any[]; relaciones: any[] } = {
    elementos: [],
    atributos: [],
    relaciones: [],
  };
  const clasesPorNombre = new Map<string, string>();
  const normalizarNombre = (nombre: string) => nombre.trim().toLocaleLowerCase();

  try {
    await prisma.$transaction(async (tx) => {
      for (const clase of interpretacion.clases) {
        const elemento = await tx.elementoDiagrama.create({
          data: {
            diagramaId: id,
            nombre: clase.nombre,
            tipo: "CLASE",
            posicionX: 100 + Math.random() * 400,
            posicionY: 100 + Math.random() * 400,
          },
          select: { id: true, nombre: true, tipo: true, posicionX: true, posicionY: true },
        });
        clasesPorNombre.set(normalizarNombre(clase.nombre), elemento.id);
        emitidos.elementos.push({ ...elemento, diagramaId: id, atributos: [] });

        for (const atributo of clase.atributos || []) {
          const creado = await tx.atributo.create({
            data: {
              elementoDiagramaId: elemento.id,
              nombre: atributo.nombre,
              tipoDato: atributo.tipoDato || "string",
              visibilidad: atributo.visibilidad || "+",
            },
            select: { id: true, nombre: true, tipoDato: true, visibilidad: true },
          });
          emitidos.atributos.push({ ...creado, elementoId: elemento.id });
        }
      }

      for (const relacion of interpretacion.relaciones) {
        const origenId = clasesPorNombre.get(normalizarNombre(relacion.origen));
        const destinoId = clasesPorNombre.get(normalizarNombre(relacion.destino));
        if (!origenId || !destinoId) continue;

        const creada = await tx.relacionUML.create({
          data: {
            tipo: relacion.tipo || "ASOCIACION",
            multiplicidadOrigen: relacion.multiplicidadOrigen || "1..*",
            multiplicidadDestino: relacion.multiplicidadDestino || "1..*",
            origenId,
            destinoId,
          },
          select: { id: true, tipo: true, multiplicidadOrigen: true, multiplicidadDestino: true, origenId: true, destinoId: true },
        });
        emitidos.relaciones.push(creada);
      }

      await tx.registroSesion.create({
        data: { usuarioId: req.usuarioId!, accion: "Importó diagrama desde imagen" },
      });
    });
  } catch (error) {
    console.error("[importar-imagen] Error al guardar diagrama:", error);
    res.status(500).json({ error: "No se pudo guardar el diagrama importado" });
    return;
  }

  const io = req.app.get("io") as Server | undefined;
  const sala = `diagrama:${id}`;
  emitidos.elementos.forEach((elemento) => io?.to(sala).emit("elemento:creado", elemento));
  emitidos.atributos.forEach((atributoCreado) => io?.to(sala).emit("atributo:creado", atributoCreado));
  emitidos.relaciones.forEach((relacion) => io?.to(sala).emit("relacion:creada", relacion));
  res.status(200).json({ clasesImportadas: emitidos.elementos.length, relacionesImportadas: emitidos.relaciones.length, errores: [] });
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
