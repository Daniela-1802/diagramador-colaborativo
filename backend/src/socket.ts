import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import prisma from "./lib/prisma";
import { AccionComando, interpretarComando, ResultadoComando } from "./gemini";

interface SocketData {
  usuarioId?: string;
  diagramaId?: string;
}

// Estrategia de resolución de conflictos: "último cambio gana" (last write wins).
// No hay bloqueo de elems ni merge de operaciones — el último write sobreescribe
// el anterior. Esto es intencional para la primera versión del sistema.

export function configurarSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    const crearElemento = async (
      diagramaId: string,
      usuarioId: string,
      datos: { nombre: string; tipo: string; posicionX: number; posicionY: number }
    ) => {
      const elemento = await prisma.elementoDiagrama.create({
        data: { diagramaId, ...datos },
        select: {
          id: true,
          nombre: true,
          tipo: true,
          posicionX: true,
          posicionY: true,
        },
      });

      await prisma.registroSesion.create({
        data: {
          usuarioId,
          accion: `Creó elemento "${datos.nombre}" en diagrama ${diagramaId}`,
        },
      });

      io.to(`diagrama:${diagramaId}`).emit("elemento:creado", {
        id: elemento.id,
        diagramaId,
        nombre: elemento.nombre,
        tipo: elemento.tipo,
        posicionX: elemento.posicionX,
        posicionY: elemento.posicionY,
        atributos: [],
      });

      return elemento;
    };

    const moverElemento = async (
      diagramaId: string,
      usuarioId: string,
      datos: { elementoId: string; posicionX: number; posicionY: number },
      incluirSocketOrigen = false
    ) => {
      await prisma.elementoDiagrama.update({
        where: { id: datos.elementoId },
        data: { posicionX: datos.posicionX, posicionY: datos.posicionY },
      });

      await prisma.registroSesion.create({
        data: {
          usuarioId,
          accion: `Movió elemento ${datos.elementoId} en diagrama ${diagramaId}`,
        },
      });

      const destino = incluirSocketOrigen ? io.to(`diagrama:${diagramaId}`) : socket.to(`diagrama:${diagramaId}`);
      destino.emit("elemento:movido", {
        elementoId: datos.elementoId,
        posicionX: datos.posicionX,
        posicionY: datos.posicionY,
      });
    };

    const eliminarElemento = async (diagramaId: string, usuarioId: string, elementoId: string) => {
      const elemento = await prisma.elementoDiagrama.findFirst({
        where: { id: elementoId, diagramaId },
      });

      if (!elemento) return null;

      const relaciones = await prisma.relacionUML.findMany({
        where: { OR: [{ origenId: elemento.id }, { destinoId: elemento.id }] },
        select: { id: true },
      });
      await prisma.$transaction([
        prisma.relacionUML.deleteMany({
          where: { OR: [{ origenId: elemento.id }, { destinoId: elemento.id }] },
        }),
        prisma.atributo.deleteMany({ where: { elementoDiagramaId: elemento.id } }),
        prisma.elementoDiagrama.delete({ where: { id: elemento.id } }),
      ]);
      await prisma.registroSesion.create({
        data: {
          usuarioId,
          accion: `Eliminó elemento ${elemento.nombre}`,
        },
      });
      relaciones.forEach((relacion) => {
        io.to(`diagrama:${diagramaId}`).emit("relacion:eliminada", {
          relacionId: relacion.id,
        });
      });
      io.to(`diagrama:${diagramaId}`).emit("elemento:eliminado", {
        elementoId: elemento.id,
      });

      return elemento;
    };

    const renombrarElemento = async (
      diagramaId: string,
      usuarioId: string,
      elementoId: string,
      nuevoNombre: string
    ) => {
      const elemento = await prisma.elementoDiagrama.findFirst({
        where: { id: elementoId, diagramaId },
      });

      if (!elemento) return null;

      const elementoActualizado = await prisma.elementoDiagrama.update({
        where: { id: elemento.id },
        data: { nombre: nuevoNombre },
      });
      await prisma.registroSesion.create({
        data: {
          usuarioId,
          accion: `Renombró elemento a ${nuevoNombre}`,
        },
      });
      io.to(`diagrama:${diagramaId}`).emit("elemento:actualizado", {
        elementoId: elementoActualizado.id,
        nuevoNombre: elementoActualizado.nombre,
      });

      return elementoActualizado;
    };

    const guardarComando = async (
      usuarioId: string,
      texto: string,
      resultado: ResultadoComando,
      exito: boolean
    ) => {
      await prisma.comandoVoz.create({
        data: {
          usuarioId,
          textoOriginal: texto,
          accionInterpretada: JSON.stringify(resultado),
          exito,
        },
      });
    };

    socket.on("diagrama:unirse", async (payload: { diagramaId: string; token: string }) => {
      try {
        const { diagramaId, token } = payload;

        if (!diagramaId || !token) {
          socket.emit("error", { mensaje: "diagramaId y token son requeridos" });
          socket.disconnect();
          return;
        }

        let usuarioId: string;
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { usuarioId: string };
          usuarioId = decoded.usuarioId;
        } catch {
          socket.emit("error", { mensaje: "Token inválido" });
          socket.disconnect();
          return;
        }

        const colaboracion = await prisma.colaboracion.findUnique({
          where: {
            usuarioId_diagramaId: { usuarioId, diagramaId },
          },
        });

        if (!colaboracion) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          socket.disconnect();
          return;
        }

        socket.data.usuarioId = usuarioId;
        socket.data.diagramaId = diagramaId;
        socket.join(`diagrama:${diagramaId}`);

        const elementos = await prisma.elementoDiagrama.findMany({
          where: { diagramaId },
          select: {
            id: true,
            nombre: true,
            tipo: true,
            posicionX: true,
            posicionY: true,
            atributos: {
              select: {
                id: true,
                nombre: true,
                tipoDato: true,
                visibilidad: true,
              },
            },
          },
        });

        const relaciones = await prisma.relacionUML.findMany({
          where: {
            origen: { diagramaId },
            destino: { diagramaId },
          },
          select: {
            id: true,
            origenId: true,
            destinoId: true,
            tipo: true,
            multiplicidadOrigen: true,
            multiplicidadDestino: true,
          },
        });

        socket.emit("diagrama:estado", { elementos, relaciones });
        console.log(`[Socket] ${usuarioId} se unió a diagrama:${diagramaId}`);
      } catch (err) {
        console.error("[Socket] Error en diagrama:unirse:", err);
        socket.emit("error", { mensaje: "Error interno del servidor" });
        socket.disconnect();
      }
    });

    socket.on("elemento:crear", async (payload: {
      diagramaId: string;
      nombre: string;
      tipo: string;
      posicionX: number;
      posicionY: number;
    }) => {
      try {
        const { diagramaId, nombre, tipo, posicionX, posicionY } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }

        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }

        await crearElemento(diagramaId, usuarioId, { nombre, tipo, posicionX, posicionY });

        console.log(`[Socket] Elemento "${nombre}" creado por ${usuarioId} en ${diagramaId}`);
      } catch (err) {
        console.error("[Socket] Error en elemento:crear:", err);
        socket.emit("error", { mensaje: "Error al crear elemento" });
      }
    });

    socket.on("atributo:crear", async (payload: {
      diagramaId: string;
      elementoId: string;
      nombre: string;
      tipoDato: string;
      visibilidad: string;
    }) => {
      try {
        const { diagramaId, elementoId, nombre, tipoDato, visibilidad } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }
        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }
        if (!nombre?.trim() || !tipoDato?.trim()) {
          socket.emit("error", { mensaje: "El nombre y tipo de dato son requeridos" });
          return;
        }
        if (!["+", "-", "#"].includes(visibilidad)) {
          socket.emit("error", { mensaje: "La visibilidad no es válida" });
          return;
        }

        const elemento = await prisma.elementoDiagrama.findFirst({
          where: { id: elementoId, diagramaId },
        });
        if (!elemento) {
          socket.emit("error", { mensaje: "El elemento no pertenece al diagrama" });
          return;
        }

        const atributo = await prisma.atributo.create({
          data: {
            nombre: nombre.trim(),
            tipoDato: tipoDato.trim(),
            visibilidad,
            elementoDiagramaId: elementoId,
          },
          select: {
            id: true,
            nombre: true,
            tipoDato: true,
            visibilidad: true,
          },
        });
        await prisma.registroSesion.create({
          data: {
            usuarioId,
            accion: `Creó atributo "${atributo.nombre}" en elemento ${elemento.nombre}`,
          },
        });
        io.to(`diagrama:${diagramaId}`).emit("atributo:creado", {
          id: atributo.id,
          elementoId,
          nombre: atributo.nombre,
          tipoDato: atributo.tipoDato,
          visibilidad: atributo.visibilidad,
        });
      } catch (err) {
        console.error("[Socket] Error en atributo:crear:", err);
        socket.emit("error", { mensaje: "Error al crear atributo" });
      }
    });

    socket.on("atributo:eliminar", async (payload: { diagramaId: string; atributoId: string }) => {
      try {
        const { diagramaId, atributoId } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }
        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }

        const atributo = await prisma.atributo.findFirst({
          where: { id: atributoId, elementoDiagrama: { diagramaId } },
          select: { id: true, nombre: true, elementoDiagramaId: true },
        });
        if (!atributo) {
          socket.emit("error", { mensaje: "No se encontró el atributo" });
          return;
        }

        await prisma.atributo.delete({ where: { id: atributoId } });
        await prisma.registroSesion.create({
          data: {
            usuarioId,
            accion: `Eliminó atributo "${atributo.nombre}"`,
          },
        });
        io.to(`diagrama:${diagramaId}`).emit("atributo:eliminado", {
          atributoId: atributo.id,
          elementoId: atributo.elementoDiagramaId,
        });
      } catch (err) {
        console.error("[Socket] Error en atributo:eliminar:", err);
        socket.emit("error", { mensaje: "Error al eliminar atributo" });
      }
    });

    socket.on("elemento:mover", async (payload: {
      diagramaId: string;
      elementoId: string;
      posicionX: number;
      posicionY: number;
    }) => {
      try {
        const { diagramaId, elementoId, posicionX, posicionY } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }

        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }

        await moverElemento(diagramaId, usuarioId, { elementoId, posicionX, posicionY });
      } catch (err) {
        console.error("[Socket] Error en elemento:mover:", err);
        socket.emit("error", { mensaje: "Error al mover elemento" });
      }
    });

    socket.on("elemento:eliminar", async (payload: { diagramaId: string; elementoId: string }) => {
      try {
        const { diagramaId, elementoId } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }
        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }

        const elemento = await eliminarElemento(diagramaId, usuarioId, elementoId);
        if (!elemento) {
          socket.emit("error", { mensaje: "No se encontró el elemento para eliminar" });
        }
      } catch (err) {
        console.error("[Socket] Error en elemento:eliminar:", err);
        socket.emit("error", { mensaje: "Error al eliminar elemento" });
      }
    });

    socket.on("elemento:renombrar", async (payload: {
      diagramaId: string;
      elementoId: string;
      nuevoNombre: string;
    }) => {
      try {
        const { diagramaId, elementoId, nuevoNombre } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }
        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }
        if (!nuevoNombre?.trim()) {
          socket.emit("error", { mensaje: "El nuevo nombre es requerido" });
          return;
        }

        const elemento = await renombrarElemento(diagramaId, usuarioId, elementoId, nuevoNombre.trim());
        if (!elemento) {
          socket.emit("error", { mensaje: "No se encontró el elemento para renombrar" });
        }
      } catch (err) {
        console.error("[Socket] Error en elemento:renombrar:", err);
        socket.emit("error", { mensaje: "Error al renombrar elemento" });
      }
    });

    socket.on("relacion:crear", async (payload: {
      diagramaId: string;
      origenId: string;
      destinoId: string;
      tipo: string;
    }) => {
      try {
        const { diagramaId, origenId, destinoId } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }
        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }

        const [origen, destino] = await Promise.all([
          prisma.elementoDiagrama.findFirst({ where: { id: origenId, diagramaId } }),
          prisma.elementoDiagrama.findFirst({ where: { id: destinoId, diagramaId } }),
        ]);
        if (!origen || !destino) {
          socket.emit("error", { mensaje: "Los elementos deben pertenecer al diagrama" });
          return;
        }

        const existente = await prisma.relacionUML.findFirst({
          where: {
            OR: [
              { origenId, destinoId },
              { origenId: destinoId, destinoId: origenId },
            ],
          },
        });
        if (existente) {
          socket.emit("error", { mensaje: "Ya existe una relación entre esos elementos" });
          return;
        }

        const relacion = await prisma.relacionUML.create({
          data: {
            tipo: "ASOCIACION",
            multiplicidadOrigen: "1..*",
            multiplicidadDestino: "1..*",
            origenId,
            destinoId,
          },
          select: {
            id: true,
            origenId: true,
            destinoId: true,
            tipo: true,
            multiplicidadOrigen: true,
            multiplicidadDestino: true,
          },
        });
        await prisma.registroSesion.create({
          data: { usuarioId, accion: `Creó relación ${origen.nombre} -> ${destino.nombre}` },
        });
        io.to(`diagrama:${diagramaId}`).emit("relacion:creada", relacion);
      } catch (err) {
        console.error("[Socket] Error en relacion:crear:", err);
        socket.emit("error", { mensaje: "Error al crear relación" });
      }
    });

    socket.on("relacion:eliminar", async (payload: { diagramaId: string; relacionId: string }) => {
      try {
        const { diagramaId, relacionId } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }
        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }

        const relacion = await prisma.relacionUML.findFirst({
          where: { id: relacionId, origen: { diagramaId }, destino: { diagramaId } },
        });
        if (!relacion) {
          socket.emit("error", { mensaje: "No se encontró la relación" });
          return;
        }

        await prisma.relacionUML.delete({ where: { id: relacionId } });
        await prisma.registroSesion.create({
          data: { usuarioId, accion: `Eliminó relación ${relacionId}` },
        });
        io.to(`diagrama:${diagramaId}`).emit("relacion:eliminada", { relacionId });
      } catch (err) {
        console.error("[Socket] Error en relacion:eliminar:", err);
        socket.emit("error", { mensaje: "Error al eliminar relación" });
      }
    });

    socket.on("relacion:actualizar", async (payload: {
      diagramaId: string;
      relacionId: string;
      tipo: string;
      multiplicidadOrigen: string;
      multiplicidadDestino: string;
    }) => {
      try {
        const { diagramaId, relacionId, tipo, multiplicidadOrigen, multiplicidadDestino } = payload;
        const usuarioId = socket.data.usuarioId as string | undefined;
        const socketDiagramaId = socket.data.diagramaId as string | undefined;

        if (!usuarioId || !socketDiagramaId) {
          socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
          return;
        }
        if (socketDiagramaId !== diagramaId) {
          socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
          return;
        }

        const relacion = await prisma.relacionUML.findFirst({
          where: {
            id: relacionId,
            origen: { diagramaId },
            destino: { diagramaId },
          },
        });
        if (!relacion) {
          socket.emit("error", { mensaje: "No se encontró la relación" });
          return;
        }

        const actualizada = await prisma.relacionUML.update({
          where: { id: relacionId },
          data: { tipo, multiplicidadOrigen, multiplicidadDestino },
          select: {
            id: true,
            tipo: true,
            multiplicidadOrigen: true,
            multiplicidadDestino: true,
          },
        });
        await prisma.registroSesion.create({
          data: {
            usuarioId,
            accion: `Actualizó relación a ${tipo} (${multiplicidadOrigen}→${multiplicidadDestino})`,
          },
        });
        io.to(`diagrama:${diagramaId}`).emit("relacion:actualizada", {
          relacionId: actualizada.id,
          tipo: actualizada.tipo,
          multiplicidadOrigen: actualizada.multiplicidadOrigen,
          multiplicidadDestino: actualizada.multiplicidadDestino,
        });
      } catch (err) {
        console.error("[Socket] Error en relacion:actualizar:", err);
        socket.emit("error", { mensaje: "Error al actualizar relación" });
      }
    });

    socket.on("comando:interpretar", async (payload: { diagramaId: string; texto: string }) => {
      const { diagramaId, texto } = payload;
      const usuarioId = socket.data.usuarioId as string | undefined;
      const socketDiagramaId = socket.data.diagramaId as string | undefined;

      if (!usuarioId || !socketDiagramaId) {
        socket.emit("error", { mensaje: "Debes unirte a un diagrama primero" });
        return;
      }

      if (socketDiagramaId !== diagramaId) {
        socket.emit("error", { mensaje: "No tienes acceso a este diagrama" });
        return;
      }

      let resultado: AccionComando = { accion: "error_conexion" };
      let resultadoCompleto: ResultadoComando = { acciones: [resultado] };
      let exito = false;
      let exitosas = 0;
      let fallidas = 0;
      const errores: string[] = [];

      try {
        const elementosDelDiagrama = await prisma.elementoDiagrama.findMany({
          where: { diagramaId },
          select: { nombre: true },
        });
        const nombresClasesExistentes = elementosDelDiagrama.map((elemento) => elemento.nombre);
        resultadoCompleto = await interpretarComando(texto, nombresClasesExistentes);
        const acciones: AccionComando[] = "acciones" in resultadoCompleto && Array.isArray(resultadoCompleto.acciones)
          ? resultadoCompleto.acciones
          : [resultadoCompleto as AccionComando];

        for (const accion of acciones) {
          resultado = accion;
          exito = false;

          try {

        if (resultado.accion === "crear_clase" && resultado.nombre) {
          await crearElemento(diagramaId, usuarioId, {
            nombre: resultado.nombre,
            tipo: "CLASE",
            posicionX: 100,
            posicionY: 100,
          });
          exito = true;
        } else if (resultado.accion === "mover_elemento" && resultado.nombre) {
          const elemento = await prisma.elementoDiagrama.findFirst({
            where: {
              diagramaId,
              nombre: { equals: resultado.nombre, mode: "insensitive" },
            },
          });

          if (!elemento) {
            socket.emit("error", { mensaje: "No encontré ninguna clase con ese nombre" });
          } else {
            const desplazamientos: Record<string, { x: number; y: number }> = {
              arriba: { x: 0, y: -50 },
              abajo: { x: 0, y: 50 },
              izquierda: { x: -50, y: 0 },
              derecha: { x: 50, y: 0 },
            };
            const desplazamiento = resultado.direccion ? desplazamientos[resultado.direccion.toLowerCase()] : undefined;

            if (!desplazamiento) {
              resultado = { accion: "desconocido" };
              socket.emit("error", { mensaje: "No entendí ese comando, intenta reformularlo" });
            } else {
              await moverElemento(diagramaId, usuarioId, {
                elementoId: elemento.id,
                posicionX: elemento.posicionX + desplazamiento.x,
                posicionY: elemento.posicionY + desplazamiento.y,
              }, true);
              exito = true;
            }
          }
        } else if (resultado.accion === "eliminar_clase" && resultado.nombre) {
          const elemento = await prisma.elementoDiagrama.findFirst({
            where: {
              diagramaId,
              nombre: { equals: resultado.nombre, mode: "insensitive" },
            },
          });

          if (!elemento) {
            socket.emit("error", { mensaje: "No encontré ninguna clase con ese nombre" });
          } else {
            exito = Boolean(await eliminarElemento(diagramaId, usuarioId, elemento.id));
          }
        } else if (resultado.accion === "renombrar_clase" && resultado.nombre && resultado.nuevoNombre) {
          const elemento = await prisma.elementoDiagrama.findFirst({
            where: {
              diagramaId,
              nombre: { equals: resultado.nombre, mode: "insensitive" },
            },
          });

          if (!elemento) {
            socket.emit("error", { mensaje: "No encontré ninguna clase con ese nombre" });
          } else {
            exito = Boolean(await renombrarElemento(diagramaId, usuarioId, elemento.id, resultado.nuevoNombre));
          }
        } else if (
          resultado.accion === "agregar_atributo" &&
          resultado.elemento &&
          resultado.atributo &&
          resultado.tipoDato
        ) {
          const elemento = await prisma.elementoDiagrama.findFirst({
            where: { diagramaId, nombre: { equals: resultado.elemento, mode: "insensitive" } },
          });

          if (!elemento) {
            socket.emit("error", { mensaje: "No encontré la clase indicada para agregar el atributo" });
          } else {
            const atributo = await prisma.atributo.create({
              data: {
                elementoDiagramaId: elemento.id,
                nombre: resultado.atributo,
                tipoDato: resultado.tipoDato,
                visibilidad: resultado.visibilidad || "+",
              },
              select: { id: true, nombre: true, tipoDato: true, visibilidad: true },
            });
            await prisma.registroSesion.create({
              data: {
                usuarioId,
                accion: `Creó atributo "${atributo.nombre}" en elemento ${elemento.nombre}`,
              },
            });
            io.to(`diagrama:${diagramaId}`).emit("atributo:creado", {
              id: atributo.id,
              elementoId: elemento.id,
              nombre: atributo.nombre,
              tipoDato: atributo.tipoDato,
              visibilidad: atributo.visibilidad,
            });
            exito = true;
          }
        } else if (
          resultado.accion === "cambiar_multiplicidad" &&
          resultado.origen &&
          resultado.destino &&
          resultado.multiplicidadOrigen &&
          resultado.multiplicidadDestino
        ) {
          const [origen, destino] = await Promise.all([
            prisma.elementoDiagrama.findFirst({
              where: { diagramaId, nombre: { equals: resultado.origen, mode: "insensitive" } },
            }),
            prisma.elementoDiagrama.findFirst({
              where: { diagramaId, nombre: { equals: resultado.destino, mode: "insensitive" } },
            }),
          ]);
          const relacion = origen && destino
            ? await prisma.relacionUML.findFirst({
                where: {
                  OR: [
                    { origenId: origen.id, destinoId: destino.id },
                    { origenId: destino.id, destinoId: origen.id },
                  ],
                },
              })
            : null;

          if (!relacion) {
            socket.emit("error", { mensaje: "No encontré la relación indicada" });
          } else {
            const actualizada = await prisma.relacionUML.update({
              where: { id: relacion.id },
              data: {
                multiplicidadOrigen: resultado.multiplicidadOrigen,
                multiplicidadDestino: resultado.multiplicidadDestino,
              },
            });
            io.to(`diagrama:${diagramaId}`).emit("relacion:actualizada", {
              relacionId: actualizada.id,
              tipo: actualizada.tipo,
              multiplicidadOrigen: actualizada.multiplicidadOrigen,
              multiplicidadDestino: actualizada.multiplicidadDestino,
            });
            exito = true;
          }
        } else if (
          resultado.accion === "crear_relacion" &&
          resultado.origen &&
          resultado.destino
        ) {
          const [origen, destino] = await Promise.all([
            prisma.elementoDiagrama.findFirst({
              where: { diagramaId, nombre: { equals: resultado.origen, mode: "insensitive" } },
            }),
            prisma.elementoDiagrama.findFirst({
              where: { diagramaId, nombre: { equals: resultado.destino, mode: "insensitive" } },
            }),
          ]);

          if (!origen || !destino) {
            socket.emit("error", { mensaje: "No encontré las clases indicadas para crear la relación" });
          } else {
            const tipoNormalizado = (resultado.tipo || "ASOCIACION").toUpperCase();
            const multiplicidadOrigen = resultado.multiplicidadOrigen || "1..*";
            const multiplicidadDestino = resultado.multiplicidadDestino || "1..*";
            const relacion = await prisma.relacionUML.create({
              data: {
                tipo: tipoNormalizado,
                multiplicidadOrigen,
                multiplicidadDestino,
                origenId: origen.id,
                destinoId: destino.id,
              },
            });
            await prisma.registroSesion.create({
              data: {
                usuarioId,
                accion: `Creó relación ${origen.nombre} → ${destino.nombre}`,
              },
            });
            io.to(`diagrama:${diagramaId}`).emit("relacion:creada", {
              id: relacion.id,
              origenId: relacion.origenId,
              destinoId: relacion.destinoId,
              tipo: relacion.tipo,
              multiplicidadOrigen: relacion.multiplicidadOrigen,
              multiplicidadDestino: relacion.multiplicidadDestino,
            });
            exito = true;
          }
        } else if (
          resultado.accion === "cambiar_tipo_relacion" &&
          resultado.origen &&
          resultado.destino &&
          resultado.tipo
        ) {
          const [origen, destino] = await Promise.all([
            prisma.elementoDiagrama.findFirst({
              where: { diagramaId, nombre: { equals: resultado.origen, mode: "insensitive" } },
            }),
            prisma.elementoDiagrama.findFirst({
              where: { diagramaId, nombre: { equals: resultado.destino, mode: "insensitive" } },
            }),
          ]);

          const relacion = origen && destino
            ? await prisma.relacionUML.findFirst({
                where: {
                  OR: [
                    { origenId: origen.id, destinoId: destino.id },
                    { origenId: destino.id, destinoId: origen.id },
                  ],
                },
              })
            : null;

          if (!relacion) {
            socket.emit("error", {
              mensaje: `No encontré una relación entre "${resultado.origen}" y "${resultado.destino}"`,
            });
          } else {
            const actualizada = await prisma.relacionUML.update({
              where: { id: relacion.id },
              data: { tipo: resultado.tipo },
              select: {
                id: true,
                tipo: true,
                multiplicidadOrigen: true,
                multiplicidadDestino: true,
              },
            });
            await prisma.registroSesion.create({
              data: {
                usuarioId,
                accion: `Cambió el tipo de relación ${relacion.id} a ${actualizada.tipo}`,
              },
            });
            io.to(`diagrama:${diagramaId}`).emit("relacion:actualizada", {
              relacionId: actualizada.id,
              tipo: actualizada.tipo,
              multiplicidadOrigen: actualizada.multiplicidadOrigen,
              multiplicidadDestino: actualizada.multiplicidadDestino,
            });
            exito = true;
          }
        } else if (resultado.accion === "desconocido") {
          socket.emit("error", { mensaje: "No entendí ese comando, intenta reformularlo" });
        } else {
          socket.emit("error", { mensaje: "No entendí ese comando, intenta reformularlo" });
        }

        if (resultado.accion === "error_conexion") {
          socket.emit("error", { mensaje: "No se pudo conectar con el servicio de IA, intenta de nuevo en unos segundos" });
        }
          if (exito) {
            exitosas++;
          } else {
            fallidas++;
          }
          } catch (err) {
            fallidas++;
            errores.push(`Error en "${resultado.accion}": ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        socket.emit("comando:completado", { exitosas, fallidas, errores });
      } catch (err) {
        console.error("[Socket] Error en comando:interpretar:", err);
        resultado = { accion: "error_conexion" };
        resultadoCompleto = { acciones: [resultado] };
        fallidas++;
        errores.push(`Error en "${resultado.accion}": ${err instanceof Error ? err.message : String(err)}`);
        socket.emit("error", { mensaje: "No se pudo conectar con el servicio de IA, intenta de nuevo en unos segundos" });
        socket.emit("comando:completado", { exitosas, fallidas, errores });
      } finally {
        try {
          await guardarComando(usuarioId, texto, resultadoCompleto, exitosas > 0);
        } catch (err) {
          console.error("[Socket] Error al guardar comando de voz:", err);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Cliente desconectado: ${socket.id}`);
      // No se requiere limpieza especial por ahora. Los sockets se eliminan
      // automáticamente de todas las rooms al desconectarse. Los datos en
      // socket.data se liberan con el objeto socket. No hay estado persistente
      // del lado del servidor más allá de lo que Prisma mantiene en la BD.
    });
  });
}
