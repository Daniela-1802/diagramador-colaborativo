import { useState, useEffect, useRef, useCallback } from "react";
import * as go from "gojs";
import socket from "../socket";

interface Colaborador {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: string;
  fechaInvitacion: string;
}

interface DiagramaData {
  id: string;
  titulo: string;
  tipo: string;
  miRol: string;
  fechaCreacion: string;
  fechaModificacion: string;
  colaboraciones: Colaborador[];
  elementos: {
    id: string;
    nombre: string;
    tipo: string;
    posicionX: number;
    posicionY: number;
    atributos: { nombre: string; tipoDato: string; visibilidad: string | null }[];
  }[];
}

interface Props {
  diagramaId: string;
  token: string;
  onVolver: () => void;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

export default function DiagramaDetalle({ diagramaId, token, onVolver }: Props) {
  const [diagrama, setDiagrama] = useState<DiagramaData | null>(null);
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [error, setError] = useState("");
  const [mostrarModal, setMostrarModal] = useState(false);
  const [emailInvitar, setEmailInvitar] = useState("");
  const [errorInvitacion, setErrorInvitacion] = useState("");
  const [exitoInvitacion, setExitoInvitacion] = useState("");
  const [cargandoInvitacion, setCargandoInvitacion] = useState(false);
  const [textoComando, setTextoComando] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const [soportaVoz, setSoportaVoz] = useState(false);
  const [errorComando, setErrorComando] = useState("");

  const diagramContainerRef = useRef<HTMLDivElement>(null);
  const diagramInstanceRef = useRef<go.Diagram | null>(null);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const reconocimientoRef = useRef<SpeechRecognitionLike | null>(null);
  const [unidoAlDiagrama, setUnidoAlDiagrama] = useState(false);

  const cargarDiagrama = async () => {
    const res = await fetch(`/diagramas/${diagramaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Error al cargar diagrama");
      return;
    }
    setDiagrama(await res.json());
  };

  const cargarColaboradores = async () => {
    const res = await fetch(`/diagramas/${diagramaId}/colaboradores`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setColaboradores(await res.json());
    }
  };

  useEffect(() => {
    cargarDiagrama();
    cargarColaboradores();
  }, [diagramaId, token]);

  // ─── useEffect A: Socket ───────────────────────────────────────────
  // Independiente de GoJS. Registra handlers y conecta el socket.
  useEffect(() => {
    const onEstado = (data: { elementos: { id: string; nombre: string; tipo: string; posicionX: number; posicionY: number }[] }) => {
      console.log("[onEstado] LLEGÓ estado con", data.elementos.length, "elementos");
      setUnidoAlDiagrama(true);
      let intentos = 0;
      const aplicar = () => {
        const diagram = diagramInstanceRef.current;
        if (!diagram) {
          if (intentos++ > 40) {
            console.warn("[onEstado] Timeout esperando GoJS");
            return;
          }
          setTimeout(aplicar, 50);
          return;
        }
        console.log("[onEstado] Aplicando", data.elementos.length, "elementos al canvas");
        diagram.startTransaction("cargar estado");
        data.elementos.forEach((el) => {
          if (diagram.model.findNodeDataForKey(el.id)) return;
          diagram.model.addNodeData({
            key: el.id,
            nombre: el.nombre,
            tipo: el.tipo,
            loc: go.Point.stringify(new go.Point(el.posicionX, el.posicionY)),
          });
          nodePositionsRef.current.set(el.id, { x: el.posicionX, y: el.posicionY });
        });
        diagram.commitTransaction("cargar estado");
      };
      aplicar();
    };

    const onCreado = (data: { id: string; diagramaId: string; nombre: string; tipo: string; posicionX: number; posicionY: number }) => {
      console.log("[onCreado] LLEGÓ evento:", data);
      let intentos = 0;
      const aplicar = () => {
        const diagram = diagramInstanceRef.current;
        if (!diagram) {
          if (intentos++ > 40) {
            console.warn("[onCreado] Timeout esperando GoJS");
            return;
          }
          setTimeout(aplicar, 50);
          return;
        }
        if (diagram.model.findNodeDataForKey(data.id)) return;
        diagram.startTransaction("agregar elemento");
        diagram.model.addNodeData({
          key: data.id,
          nombre: data.nombre,
          tipo: data.tipo,
          loc: go.Point.stringify(new go.Point(data.posicionX, data.posicionY)),
        });
        nodePositionsRef.current.set(data.id, { x: data.posicionX, y: data.posicionY });
        diagram.commitTransaction("agregar elemento");
      };
      aplicar();
    };

    const onMovido = (data: { elementoId: string; posicionX: number; posicionY: number }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const node = diagram.findNodeForKey(data.elementoId);
      if (node) {
        diagram.startTransaction("mover elemento remoto");
        node.position = new go.Point(data.posicionX, data.posicionY);
        diagram.commitTransaction("mover elemento remoto");
        nodePositionsRef.current.set(data.elementoId, { x: data.posicionX, y: data.posicionY });
      }
    };

    const onEliminado = (data: { elementoId: string }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const model = diagram.model;
      const nodeData = model.findNodeDataForKey(data.elementoId);
      if (!nodeData) return;
      model.startTransaction("eliminar elemento remoto");
      model.removeNodeData(nodeData);
      model.commitTransaction("eliminar elemento remoto");
      nodePositionsRef.current.delete(data.elementoId);
    };

    const onActualizado = (data: { elementoId: string; nuevoNombre: string }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const nodeData = diagram.model.findNodeDataForKey(data.elementoId);
      if (!nodeData) return;
      diagram.model.startTransaction("actualizar elemento remoto");
      diagram.model.setDataProperty(nodeData, "nombre", data.nuevoNombre);
      diagram.model.commitTransaction("actualizar elemento remoto");
    };

    const onRelacionCreada = (data: {
      id: string;
      tipo: string;
      origenId: string;
      destinoId: string;
      multiplicidadOrigen: string | null;
      multiplicidadDestino: string | null;
    }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const model = diagram.model as go.GraphLinksModel;
      if (model.findLinkDataForKey(data.id)) return;
      if (!model.findNodeDataForKey(data.origenId) || !model.findNodeDataForKey(data.destinoId)) return;
      model.startTransaction("crear relación remota");
      model.addLinkData({
        key: data.id,
        from: data.origenId,
        to: data.destinoId,
        multiplicidadOrigen: data.multiplicidadOrigen,
        multiplicidadDestino: data.multiplicidadDestino,
        tipo: data.tipo,
      });
      model.commitTransaction("crear relación remota");
    };

    const onError = (data: { mensaje: string }) => {
      console.error("[onError]", data.mensaje);
      setErrorComando(data.mensaje);
    };

    const onConnect = () => {
      console.log("[onConnect] socket conectado, emitiendo diagrama:unirse");
      socket.emit("diagrama:unirse", { diagramaId, token });
    };

    socket.on("diagrama:estado", onEstado);
    socket.on("elemento:creado", onCreado);
    socket.on("elemento:movido", onMovido);
    socket.on("elemento:eliminado", onEliminado);
    socket.on("elemento:actualizado", onActualizado);
    socket.on("relacion:creada", onRelacionCreada);
    socket.on("error", onError);
    socket.on("connect", onConnect);

    if (socket.connected) {
      socket.emit("diagrama:unirse", { diagramaId, token });
    } else {
      socket.connect();
    }

    return () => {
      setUnidoAlDiagrama(false);
      socket.off("diagrama:estado", onEstado);
      socket.off("elemento:creado", onCreado);
      socket.off("elemento:movido", onMovido);
      socket.off("elemento:eliminado", onEliminado);
      socket.off("elemento:actualizado", onActualizado);
      socket.off("relacion:creada", onRelacionCreada);
      socket.off("error", onError);
      socket.off("connect", onConnect);
    };
  }, [diagramaId, token]);

  useEffect(() => {
    const speechWindow = window as WindowWithSpeechRecognition;
    setSoportaVoz(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));

    return () => {
      reconocimientoRef.current?.stop();
      reconocimientoRef.current = null;
    };
  }, []);

  // ─── useEffect B: GoJS ────────────────────────────────────────────
  useEffect(() => {
    if (!diagramContainerRef.current) return;

    const $ = go.GraphObject.make;

    const diagram = new go.Diagram(diagramContainerRef.current, {
      "undoManager.isEnabled": true,
      layout: $(go.GridLayout, { wrappingColumn: 3, spacing: new go.Size(30, 30) }),
    });

    diagram.nodeTemplate = $(
      go.Node,
      "Auto",
      new go.Binding("position", "loc", go.Point.parse).makeTwoWay(
        go.Point.stringify
      ),
      $(go.Shape, "RoundedRectangle", {
        fill: "white",
        stroke: "#1a1a2e",
        strokeWidth: 2,
        width: 140,
        height: 80,
      }),
      $(
        go.Panel,
        "Vertical",
        { margin: 4 },
        $(
          go.TextBlock,
          {
            alignment: go.Spot.Center,
            font: "bold 13px system-ui, sans-serif",
            stroke: "#1a1a2e",
            margin: 4,
          },
          new go.Binding("text", "nombre")
        ),
        $(
          go.TextBlock,
          {
            alignment: go.Spot.Center,
            font: "10px system-ui, sans-serif",
            stroke: "#888",
            margin: 2,
          },
          new go.Binding("text", "tipo")
        )
      )
    );

    diagram.linkTemplate = $(
      go.Link,
      { routing: go.Link.AvoidsNodes, corner: 8, relinkableFrom: false, relinkableTo: false },
      $(go.Shape, { stroke: "#1a1a2e", strokeWidth: 1.5 }),
      $(go.Shape, { toArrow: "Standard", fill: "#1a1a2e", stroke: null }),
      $(
        go.Panel,
        "Auto",
        { segmentFraction: 0.2 },
        $(go.Shape, "RoundedRectangle", { fill: "white", stroke: null }),
        $(go.TextBlock, { margin: 2, font: "10px system-ui, sans-serif", stroke: "#1a1a2e" },
          new go.Binding("text", "multiplicidadOrigen", (value) => value || ""))
      ),
      $(
        go.Panel,
        "Auto",
        { segmentFraction: 0.8 },
        $(go.Shape, "RoundedRectangle", { fill: "white", stroke: null }),
        $(go.TextBlock, { margin: 2, font: "10px system-ui, sans-serif", stroke: "#1a1a2e" },
          new go.Binding("text", "multiplicidadDestino", (value) => value || ""))
      )
    );

    diagram.model = new go.GraphLinksModel({
      nodeKeyProperty: "key",
    });

    diagramInstanceRef.current = diagram;

    const handleMouseUp = () => {
      diagram.nodes.each((node) => {
        const key = node.data.key as string;
        const lastPos = nodePositionsRef.current.get(key);
        if (lastPos) {
          const currentX = node.position.x;
          const currentY = node.position.y;
          if (lastPos.x !== currentX || lastPos.y !== currentY) {
            socket.emit("elemento:mover", {
              diagramaId,
              elementoId: key,
              posicionX: currentX,
              posicionY: currentY,
            });
            nodePositionsRef.current.set(key, { x: currentX, y: currentY });
          }
        }
      });
    };
    diagramContainerRef.current.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (diagramContainerRef.current) {
        diagramContainerRef.current.removeEventListener("mouseup", handleMouseUp);
      }
      try {
        if (diagram && typeof diagram.dispose === "function") {
          diagram.div = null;
          diagram.dispose();
        }
      } catch (e) {
        console.warn("[GoJS cleanup] Error al disponer diagrama:", e);
      }
      diagramInstanceRef.current = null;
      if (diagramContainerRef.current) {
        diagramContainerRef.current.innerHTML = "";
      }
    };
  }, [diagramaId, diagrama]);

  const agregarClase = useCallback(() => {
    const nombre = prompt("Nombre de la clase:");
    if (!nombre || !nombre.trim()) return;

    socket.emit("elemento:crear", {
      diagramaId,
      nombre: nombre.trim(),
      tipo: "CLASE",
      posicionX: 100 + Math.random() * 200,
      posicionY: 100 + Math.random() * 200,
    });
  }, [diagramaId]);

  const enviarComando = useCallback((texto: string) => {
    const comando = texto.trim();
    if (!comando || !unidoAlDiagrama) return;

    setErrorComando("");
    socket.emit("comando:interpretar", { diagramaId, texto: comando });
    setTextoComando("");
  }, [diagramaId, unidoAlDiagrama]);

  const enviarComandoTexto = (e: React.FormEvent) => {
    e.preventDefault();
    enviarComando(textoComando);
  };

  const iniciarEscucha = () => {
    const speechWindow = window as WindowWithSpeechRecognition;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition || escuchando) return;

    const reconocimiento = new SpeechRecognition();
    reconocimiento.lang = "es-ES";
    reconocimiento.interimResults = false;
    reconocimiento.continuous = false;
    reconocimiento.onresult = (event) => {
      const resultado = event.results[event.resultIndex];
      if (resultado?.isFinal) {
        enviarComando(resultado[0].transcript);
      }
    };
    reconocimiento.onerror = () => {
      setEscuchando(false);
      setErrorComando("No se pudo acceder al micrófono");
    };
    reconocimiento.onend = () => {
      setEscuchando(false);
      reconocimientoRef.current = null;
    };

    reconocimientoRef.current = reconocimiento;
    setErrorComando("");
    setEscuchando(true);
    reconocimiento.start();
  };

  const invitarColaborador = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargandoInvitacion(true);
    setErrorInvitacion("");
    setExitoInvitacion("");

    const res = await fetch(`/diagramas/${diagramaId}/invitar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: emailInvitar }),
    });

    const data = await res.json();

    if (res.status === 201) {
      setExitoInvitacion("Colaborador agregado exitosamente");
      setEmailInvitar("");
      cargarColaboradores();
      setTimeout(() => {
        setMostrarModal(false);
        setExitoInvitacion("");
      }, 1500);
    } else if (res.status === 200) {
      setExitoInvitacion(data.mensaje);
      setEmailInvitar("");
      setTimeout(() => {
        setMostrarModal(false);
        setExitoInvitacion("");
      }, 1500);
    } else if (res.status === 400) {
      setErrorInvitacion(data.error);
    } else if (res.status === 403) {
      setErrorInvitacion(data.error);
    } else if (res.status === 404) {
      setErrorInvitacion("El usuario no está registrado. Pídele que se registre primero.");
    } else {
      setErrorInvitacion(data.error || "Error al invitar colaborador");
    }

    setCargandoInvitacion(false);
  };

  if (error) {
    return (
      <div style={styles.contenedor}>
        <p style={styles.error}>{error}</p>
        <button style={styles.botonVolver} onClick={onVolver}>Volver</button>
      </div>
    );
  }

  if (!diagrama) {
    return <div style={styles.contenedor}><p>Cargando...</p></div>;
  }

  return (
    <div style={styles.contenedor}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.botonVolver} onClick={onVolver}>&larr; Volver</button>
          <h1 style={styles.titulo}>{diagrama.titulo}</h1>
        </div>
        <span style={styles.tipoBadge}>
          {diagrama.tipo === "CLASES" ? "Diagrama de Clases" : "Entidad-Relación"}
        </span>
      </header>
      <main style={styles.main}>
        <section style={styles.seccion}>
          <div style={styles.filaTitulo}>
            <h2 style={styles.seccionTitulo}>Colaboradores</h2>
            {diagrama.miRol === "PROPIETARIO" && (
              <button style={styles.botonInvitar} onClick={() => setMostrarModal(true)}>
                + Invitar colaborador
              </button>
            )}
          </div>
          <ul style={styles.lista}>
            {colaboradores.map((c) => (
              <li key={c.usuarioId} style={styles.listaItem}>
                <strong>{c.nombre}</strong>
                <span style={styles.email}>{c.email}</span>
                <span style={styles.rol}>{c.rol}</span>
              </li>
            ))}
          </ul>
        </section>

        <section style={styles.seccion}>
          <div style={styles.filaTitulo}>
            <h2 style={styles.seccionTitulo}>Canvas</h2>
            <button
              style={{
                ...styles.botonInvitar,
                opacity: unidoAlDiagrama ? 1 : 0.5,
                cursor: unidoAlDiagrama ? "pointer" : "not-allowed",
              }}
              onClick={agregarClase}
              disabled={!unidoAlDiagrama}
            >
              {unidoAlDiagrama ? "+ Agregar clase" : "Conectando..."}
            </button>
            {soportaVoz && (
              <button
                style={{ ...styles.botonInvitar, backgroundColor: escuchando ? "#e63946" : "#2a9d8f" }}
                onClick={iniciarEscucha}
                disabled={!unidoAlDiagrama || escuchando}
              >
                {escuchando ? "Escuchando..." : "Micrófono"}
              </button>
            )}
          </div>
          <form style={styles.comandoForm} onSubmit={enviarComandoTexto}>
            <input
              style={styles.inputComando}
              type="text"
              placeholder="Escribe un comando, por ejemplo: crear clase Producto"
              value={textoComando}
              onChange={(e) => setTextoComando(e.target.value)}
              disabled={!unidoAlDiagrama}
            />
            <button style={styles.botonEnviar} type="submit" disabled={!unidoAlDiagrama || !textoComando.trim()}>
              Enviar
            </button>
          </form>
          {errorComando && <p style={styles.errorComando}>{errorComando}</p>}
          <div
            ref={diagramContainerRef}
            style={{
              width: "100%",
              height: "500px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              backgroundColor: "white",
            }}
          />
        </section>
      </main>

      {mostrarModal && (
        <div style={styles.overlay} onClick={() => setMostrarModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitulo}>Invitar Colaborador</h2>
            <form onSubmit={invitarColaborador}>
              <label style={styles.label}>Email del usuario</label>
              <input
                style={styles.input}
                type="email"
                placeholder="correo@ejemplo.com"
                value={emailInvitar}
                onChange={(e) => setEmailInvitar(e.target.value)}
                required
              />

              {errorInvitacion && <p style={styles.errorModal}>{errorInvitacion}</p>}
              {exitoInvitacion && <p style={styles.exito}>{exitoInvitacion}</p>}

              <div style={styles.botones}>
                <button type="button" style={styles.botonCancelar} onClick={() => setMostrarModal(false)}>
                  Cancelar
                </button>
                <button type="submit" style={styles.botonCrear} disabled={cargandoInvitacion}>
                  {cargandoInvitacion ? "Invitando..." : "Invitar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  contenedor: { minHeight: "100vh", fontFamily: "system-ui, sans-serif", backgroundColor: "#f0f2f5" },
  header: {
    backgroundColor: "#1a1a2e", color: "white", padding: "1rem 2rem",
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: "1rem" },
  botonVolver: {
    padding: "0.4rem 0.75rem", backgroundColor: "transparent", color: "white",
    border: "1px solid rgba(255,255,255,0.3)", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem",
  },
  titulo: { margin: 0, fontSize: "1.15rem" },
  tipoBadge: {
    fontSize: "0.75rem", padding: "0.25rem 0.6rem", borderRadius: "4px",
    backgroundColor: "rgba(255,255,255,0.15)", fontWeight: 600,
  },
  main: { padding: "2rem", maxWidth: "1000px", margin: "0 auto" },
  seccion: { marginBottom: "2rem" },
  filaTitulo: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" },
  seccionTitulo: { fontSize: "1.1rem", color: "#1a1a2e", margin: 0 },
  botonInvitar: {
    padding: "0.5rem 1rem", backgroundColor: "#4361ee", color: "white",
    border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600,
  },
  comandoForm: { display: "flex", gap: "0.5rem", marginBottom: "0.75rem" },
  inputComando: {
    flex: 1, padding: "0.6rem", border: "1px solid #ddd", borderRadius: "4px", fontSize: "0.9rem",
  },
  botonEnviar: {
    padding: "0.5rem 1rem", backgroundColor: "#2a9d8f", color: "white", border: "none",
    borderRadius: "4px", cursor: "pointer", fontWeight: 600,
  },
  errorComando: { color: "#e63946", fontSize: "0.85rem", margin: "0 0 0.75rem" },
  lista: { listStyle: "none", padding: 0, margin: 0 },
  listaItem: {
    backgroundColor: "white", padding: "0.75rem 1rem", marginBottom: "0.5rem",
    borderRadius: "6px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    display: "flex", alignItems: "center", gap: "0.75rem",
  },
  email: { fontSize: "0.8rem", color: "#888" },
  rol: { fontSize: "0.8rem", color: "#4361ee", fontWeight: 500 },
  error: { color: "#e63946", fontSize: "1rem", marginBottom: "1rem" },
  overlay: {
    position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    backgroundColor: "white", borderRadius: "8px", padding: "2rem",
    width: "100%", maxWidth: "420px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
  },
  modalTitulo: { margin: "0 0 1.25rem", fontSize: "1.25rem", color: "#1a1a2e" },
  label: { display: "block", marginBottom: "0.35rem", fontSize: "0.875rem", color: "#555", fontWeight: 500 },
  input: {
    width: "100%", padding: "0.6rem", marginBottom: "1rem", border: "1px solid #ddd",
    borderRadius: "4px", fontSize: "0.95rem", boxSizing: "border-box",
  },
  errorModal: { color: "#e63946", fontSize: "0.85rem", marginBottom: "0.75rem" },
  exito: { color: "#2e7d32", fontSize: "0.85rem", marginBottom: "0.75rem" },
  botones: { display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" },
  botonCancelar: {
    padding: "0.6rem 1rem", backgroundColor: "transparent", color: "#666",
    border: "1px solid #ddd", borderRadius: "4px", cursor: "pointer",
  },
  botonCrear: {
    padding: "0.6rem 1.25rem", backgroundColor: "#4361ee", color: "white",
    border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600,
  },
};