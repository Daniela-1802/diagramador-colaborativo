import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import prisma from "./lib/prisma";
import { interpretarComando, ResultadoComando } from "./gemini";

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

      await prisma.elementoDiagrama.delete({ where: { id: elemento.id } });
      await prisma.registroSesion.create({
        data: {
          usuarioId,
          accion: `Eliminó elemento ${elemento.nombre}`,
        },
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
          },
        });

        socket.emit("diagrama:estado", { elementos });
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

      let resultado: ResultadoComando = { accion: "error_conexion" };
      let exito = false;

      try {
        resultado = await interpretarComando(texto);

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
          resultado.accion === "crear_relacion" &&
          resultado.origen &&
          resultado.destino &&
          resultado.multiplicidad
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
            const relacion = await prisma.relacionUML.create({
              data: {
                tipo: resultado.tipo || "asociacion",
                multiplicidadOrigen: resultado.multiplicidad,
                origenId: origen.id,
                destinoId: destino.id,
              },
            });
            io.to(`diagrama:${diagramaId}`).emit("relacion:creada", relacion);
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
      } catch (err) {
        console.error("[Socket] Error en comando:interpretar:", err);
        resultado = { accion: "error_conexion" };
        socket.emit("error", { mensaje: "No se pudo conectar con el servicio de IA, intenta de nuevo en unos segundos" });
      } finally {
        try {
          await guardarComando(usuarioId, texto, resultado, exito);
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
