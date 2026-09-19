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
    atributos: Atributo[];
  }[];
}

interface Atributo {
  id: string;
  nombre: string;
  tipoDato: string;
  visibilidad: string | null;
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

interface RelacionSeleccionada {
  id: string;
  tipo: string;
  multiplicidadOrigen: string;
  multiplicidadDestino: string;
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
  const [mostrarModalRelacion, setMostrarModalRelacion] = useState(false);
  const [relacionSeleccionada, setRelacionSeleccionada] = useState<RelacionSeleccionada | null>(null);
  const [mostrarModalAtributos, setMostrarModalAtributos] = useState(false);
  const [nodoSeleccionado, setNodoSeleccionado] = useState<string | null>(null);
  const [nombreNodo, setNombreNodo] = useState("");
  const [atributosNodo, setAtributosNodo] = useState<Atributo[]>([]);
  const [nombreAtributo, setNombreAtributo] = useState("");
  const [tipoDatoAtributo, setTipoDatoAtributo] = useState("");
  const [visibilidadAtributo, setVisibilidadAtributo] = useState("+");

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
    const onEstado = (data: {
      elementos: { id: string; nombre: string; tipo: string; posicionX: number; posicionY: number; atributos: Atributo[] }[];
      relaciones?: {
        id: string;
        origenId: string;
        destinoId: string;
        tipo: string;
        multiplicidadOrigen: string | null;
        multiplicidadDestino: string | null;
      }[];
    }) => {
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
            atributos: el.atributos || [],
          });
          nodePositionsRef.current.set(el.id, { x: el.posicionX, y: el.posicionY });
        });
        const model = diagram.model as go.GraphLinksModel;
        data.relaciones?.forEach((relation) => {
          if (model.findLinkDataForKey(relation.id)) return;
          model.addLinkData({
            key: relation.id,
            origenId: relation.origenId,
            destinoId: relation.destinoId,
            tipo: relation.tipo,
            multiplicidadOrigen: relation.multiplicidadOrigen,
            multiplicidadDestino: relation.multiplicidadDestino,
            multiplicidad: `${relation.multiplicidadOrigen || ""} → ${relation.multiplicidadDestino || ""}`,
          });
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
          atributos: [],
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
      const model = diagram.model as go.GraphLinksModel;
      const nodeData = model.findNodeDataForKey(data.elementoId);
      model.startTransaction("eliminar elemento remoto");
      model.linkDataArray
        .filter((linkData) => linkData.origenId === data.elementoId || linkData.destinoId === data.elementoId)
        .forEach((linkData) => model.removeLinkData(linkData));
      if (nodeData) model.removeNodeData(nodeData);
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

    const onAtributoCreado = (data: {
      id: string;
      elementoId: string;
      nombre: string;
      tipoDato: string;
      visibilidad: string | null;
    }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const nodeData = diagram.model.findNodeDataForKey(data.elementoId);
      if (!nodeData) return;
      const atributos = (nodeData.atributos || []) as Atributo[];
      if (atributos.some((atributo) => atributo.id === data.id)) return;
      diagram.model.startTransaction("crear atributo remoto");
      diagram.model.setDataProperty(nodeData, "atributos", [...atributos, data]);
      diagram.model.commitTransaction("crear atributo remoto");
      setAtributosNodo((actuales) =>
        actuales.some((atributo) => atributo.id === data.id) ? actuales : [...actuales, data]
      );
    };

    const onAtributoEliminado = (data: { atributoId: string; elementoId: string }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const nodeData = diagram.model.findNodeDataForKey(data.elementoId);
      if (!nodeData) return;
      const atributos = (nodeData.atributos || []) as Atributo[];
      diagram.model.startTransaction("eliminar atributo remoto");
      diagram.model.setDataProperty(
        nodeData,
        "atributos",
        atributos.filter((atributo) => atributo.id !== data.atributoId)
      );
      diagram.model.commitTransaction("eliminar atributo remoto");
      setAtributosNodo((actuales) => actuales.filter((atributo) => atributo.id !== data.atributoId));
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
        origenId: data.origenId,
        destinoId: data.destinoId,
        multiplicidadOrigen: data.multiplicidadOrigen,
        multiplicidadDestino: data.multiplicidadDestino,
        multiplicidad: `${data.multiplicidadOrigen || ""} → ${data.multiplicidadDestino || ""}`,
        tipo: data.tipo,
      });
      model.commitTransaction("crear relación remota");
    };

    const onRelacionActualizada = (data: {
      relacionId: string;
      tipo: string;
      multiplicidadOrigen: string | null;
      multiplicidadDestino: string | null;
    }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const model = diagram.model as go.GraphLinksModel;
      const linkData = model.findLinkDataForKey(data.relacionId);
      if (!linkData) return;
      model.startTransaction("actualizar relación remota");
      model.setDataProperty(linkData, "tipo", data.tipo);
      model.setDataProperty(linkData, "multiplicidadOrigen", data.multiplicidadOrigen);
      model.setDataProperty(linkData, "multiplicidadDestino", data.multiplicidadDestino);
      model.setDataProperty(linkData, "multiplicidad", `${data.multiplicidadOrigen || ""} → ${data.multiplicidadDestino || ""}`);
      model.commitTransaction("actualizar relación remota");
    };

    const onRelacionEliminada = (data: { relacionId: string }) => {
      const diagram = diagramInstanceRef.current;
      if (!diagram) return;
      const model = diagram.model as go.GraphLinksModel;
      const linkData = model.findLinkDataForKey(data.relacionId);
      if (!linkData) return;
      model.startTransaction("eliminar relación remota");
      model.removeLinkData(linkData);
      model.commitTransaction("eliminar relación remota");
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
    socket.on("atributo:creado", onAtributoCreado);
    socket.on("atributo:eliminado", onAtributoEliminado);
    socket.on("relacion:creada", onRelacionCreada);
    socket.on("relacion:eliminada", onRelacionEliminada);
    socket.on("relacion:actualizada", onRelacionActualizada);
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
      socket.off("atributo:creado", onAtributoCreado);
      socket.off("atributo:eliminado", onAtributoEliminado);
      socket.off("relacion:creada", onRelacionCreada);
      socket.off("relacion:eliminada", onRelacionEliminada);
      socket.off("relacion:actualizada", onRelacionActualizada);
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
      allowMove: true,
      allowDragOut: false,
      "draggingTool.isEnabled": true,
      "draggingTool.dragsLink": false,
      "draggingTool.dragsTree": false,
      "linkingTool.isEnabled": true,
      "linkingTool.direction": go.LinkingTool.ForwardsOnly,
      "linkingTool.isUnconnectedLinkValid": false,
    });

    diagram.linkSelectionAdornmentTemplate = $(go.Adornment);
    diagram.nodeSelectionAdornmentTemplate = $(go.Adornment);

    diagram.nodeTemplate = $(
      go.Node,
      "Auto",
      { movable: true, selectable: true },
      new go.Binding("position", "loc", go.Point.parse).makeTwoWay(
        go.Point.stringify
      ),
      $(go.Shape, "RoundedRectangle", {
        name: "BODY",
        fill: "white",
        stroke: "#1a1a2e",
        strokeWidth: 2,
        width: 140,
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
        $(go.Shape, "LineH", { width: 132, stroke: "#1a1a2e", strokeWidth: 1 }),
        $(
          go.Panel,
          "Vertical",
          { defaultAlignment: go.Spot.Left, itemTemplate: $(
            go.Panel,
            "Horizontal",
            $(
              go.TextBlock,
              { font: "11px system-ui, sans-serif", stroke: "#333", margin: new go.Margin(2, 4) },
              new go.Binding("text", "", (atributo: Atributo) =>
                `${atributo.visibilidad || "+"} ${atributo.nombre}: ${atributo.tipoDato}`
              )
            )
          ) },
          new go.Binding("itemArray", "atributos")
        )
      ),
      $(go.Shape, "Circle", {
        alignment: go.Spot.Right,
        width: 14,
        height: 14,
        fill: "#4361ee",
        stroke: "white",
        strokeWidth: 2,
        portId: "right",
        fromLinkable: true,
        fromLinkableSelfNode: false,
        fromLinkableDuplicates: false,
        toLinkable: true,
        toLinkableSelfNode: false,
        toLinkableDuplicates: false,
        cursor: "pointer",
        fromSpot: go.Spot.Right,
        toSpot: go.Spot.Right,
      }),
      $(go.Shape, "Circle", {
        alignment: go.Spot.Left,
        width: 14,
        height: 14,
        fill: "#4361ee",
        stroke: "white",
        strokeWidth: 2,
        portId: "left",
        fromLinkable: true,
        fromLinkableSelfNode: false,
        fromLinkableDuplicates: false,
        toLinkable: true,
        toLinkableSelfNode: false,
        toLinkableDuplicates: false,
        cursor: "pointer",
        fromSpot: go.Spot.Left,
        toSpot: go.Spot.Left,
      })
    );

    diagram.toolManager.linkingTool.portGravity = 50;
    diagram.toolManager.linkingTool.isEnabled = true;
    diagram.toolManager.linkingTool.direction = go.LinkingTool.ForwardsOnly;
    diagram.allowMove = true;
    diagram.allowDragOut = false;
    diagram.toolManager.draggingTool.isEnabled = true;
    diagram.toolManager.draggingTool.dragsLink = false;

    diagram.linkTemplateMap.add("ASOCIACION", $(
      go.Link,
      { routing: go.Link.Orthogonal, corner: 5 },
      $(go.Shape, { strokeWidth: 2, stroke: "#1a1a2e", fill: null }),
      $(go.Shape, { toArrow: "Standard", fill: "white", stroke: "#1a1a2e" }),
      $(go.TextBlock,
        { segmentOffset: new go.Point(0, -10), font: "11px sans-serif", stroke: "#555", background: null },
        new go.Binding("text", "multiplicidad"))
    ));

    diagram.linkTemplateMap.add("HERENCIA", $(
      go.Link,
      { routing: go.Link.Orthogonal, corner: 5 },
      $(go.Shape, { strokeWidth: 2, stroke: "#1a1a2e", fill: null }),
      $(go.Shape, { toArrow: "Triangle", fill: "white", stroke: "#1a1a2e" })
    ));

    diagram.linkTemplateMap.add("COMPOSICION", $(
      go.Link,
      { routing: go.Link.Orthogonal, corner: 5 },
      $(go.Shape, { strokeWidth: 2, stroke: "#1a1a2e", fill: null }),
      $(go.Shape, { toArrow: "Diamond", fill: "#1a1a2e", stroke: "#1a1a2e" }),
      $(go.TextBlock,
        { segmentOffset: new go.Point(0, -10), font: "11px sans-serif", stroke: "#555", background: null },
        new go.Binding("text", "multiplicidad"))
    ));

    diagram.linkTemplateMap.add("AGREGACION", $(
      go.Link,
      { routing: go.Link.Orthogonal, corner: 5 },
      $(go.Shape, { strokeWidth: 2, stroke: "#1a1a2e", fill: null }),
      $(go.Shape, { toArrow: "Diamond", fill: "white", stroke: "#1a1a2e" }),
      $(go.TextBlock,
        { segmentOffset: new go.Point(0, -10), font: "11px sans-serif", stroke: "#555", background: null },
        new go.Binding("text", "multiplicidad"))
    ));

    diagram.model = new go.GraphLinksModel({
      nodeKeyProperty: "key",
      linkKeyProperty: "key",
      linkFromKeyProperty: "origenId",
      linkToKeyProperty: "destinoId",
      linkCategoryProperty: "tipo",
    });

    diagramInstanceRef.current = diagram;

    diagram.addDiagramListener("LinkDrawn", (event) => {
      const link = event.subject as go.Link;
      const origenId = link.data.origenId as string | undefined;
      const destinoId = link.data.destinoId as string | undefined;
      if (!origenId || !destinoId) return;
      const model = diagram.model as go.GraphLinksModel;
      model.setDataProperty(link.data, "tipo", "ASOCIACION");
      model.setDataProperty(link.data, "multiplicidadOrigen", "1..*");
      model.setDataProperty(link.data, "multiplicidadDestino", "1..*");
      model.setDataProperty(link.data, "multiplicidad", "1..* → 1..*");
      socket.emit("relacion:crear", {
        diagramaId,
        origenId,
        destinoId,
        tipo: "ASOCIACION",
      });
      (diagram.model as go.GraphLinksModel).removeLinkData(link.data);
    });

    diagram.addDiagramListener("ObjectSingleClicked", (event) => {
      const part = event.subject.part;
      if (part instanceof go.Link) {
        setRelacionSeleccionada({
          id: part.data.key,
          tipo: part.data.tipo || "ASOCIACION",
          multiplicidadOrigen: part.data.multiplicidadOrigen || "1..*",
          multiplicidadDestino: part.data.multiplicidadDestino || "1..*",
        });
        setMostrarModalRelacion(true);
        return;
      }
      if (part instanceof go.Node) {
        setNodoSeleccionado(part.data.key);
        setNombreNodo(part.data.nombre);
        setAtributosNodo(part.data.atributos || []);
        setMostrarModalAtributos(true);
      }
    });

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
        // No-op placeholder for future diagram configurations
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

  const guardarRelacion = () => {
    if (!relacionSeleccionada) return;
    socket.emit("relacion:actualizar", {
      diagramaId,
      relacionId: relacionSeleccionada.id,
      tipo: relacionSeleccionada.tipo,
      multiplicidadOrigen: relacionSeleccionada.multiplicidadOrigen,
      multiplicidadDestino: relacionSeleccionada.multiplicidadDestino,
    });
    setMostrarModalRelacion(false);
    setRelacionSeleccionada(null);
  };

  const agregarAtributo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodoSeleccionado || !nombreAtributo.trim() || !tipoDatoAtributo.trim()) return;
    socket.emit("atributo:crear", {
      diagramaId,
      elementoId: nodoSeleccionado,
      nombre: nombreAtributo.trim(),
      tipoDato: tipoDatoAtributo.trim(),
      visibilidad: visibilidadAtributo,
    });
    setNombreAtributo("");
    setTipoDatoAtributo("");
    setVisibilidadAtributo("+");
  };

  const cerrarModalAtributos = () => {
    setMostrarModalAtributos(false);
    setNodoSeleccionado(null);
    setAtributosNodo([]);
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

      {mostrarModalAtributos && nodoSeleccionado && (
        <div style={styles.overlay} onClick={cerrarModalAtributos}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitulo}>Atributos de {nombreNodo}</h2>
            <div style={styles.listaAtributos}>
              {atributosNodo.map((atributo) => (
                <div key={atributo.id} style={styles.atributoItem}>
                  <span>{atributo.visibilidad || "+"} {atributo.nombre}: {atributo.tipoDato}</span>
                  <button
                    type="button"
                    style={styles.botonEliminarAtributo}
                    onClick={() => socket.emit("atributo:eliminar", { diagramaId, atributoId: atributo.id })}
                  >
                    Eliminar
                  </button>
                </div>
              ))}
              {atributosNodo.length === 0 && <p style={styles.sinAtributos}>No hay atributos.</p>}
            </div>
            <form onSubmit={agregarAtributo}>
              <label style={styles.label}>Nombre</label>
              <input
                style={styles.input}
                value={nombreAtributo}
                onChange={(e) => setNombreAtributo(e.target.value)}
                required
              />
              <label style={styles.label}>Tipo de dato</label>
              <input
                style={styles.input}
                placeholder="string, int, boolean, Date..."
                value={tipoDatoAtributo}
                onChange={(e) => setTipoDatoAtributo(e.target.value)}
                required
              />
              <label style={styles.label}>Visibilidad</label>
              <select
                style={styles.input}
                value={visibilidadAtributo}
                onChange={(e) => setVisibilidadAtributo(e.target.value)}
              >
                <option value="+">+ (público)</option>
                <option value="-">- (privado)</option>
                <option value="#"># (protegido)</option>
              </select>
              <div style={styles.botones}>
                <button type="button" style={styles.botonCancelar} onClick={cerrarModalAtributos}>
                  Cerrar
                </button>
                <button type="submit" style={styles.botonCrear}>Agregar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mostrarModalRelacion && relacionSeleccionada && (
        <div style={styles.overlay} onClick={() => setMostrarModalRelacion(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitulo}>Editar Relación</h2>
            <label style={styles.label}>Tipo</label>
            <select
              style={styles.input}
              value={relacionSeleccionada.tipo}
              onChange={(e) => setRelacionSeleccionada({ ...relacionSeleccionada, tipo: e.target.value })}
            >
              <option value="ASOCIACION">ASOCIACION</option>
              <option value="HERENCIA">HERENCIA</option>
              <option value="COMPOSICION">COMPOSICION</option>
              <option value="AGREGACION">AGREGACION</option>
            </select>

            <label style={styles.label}>Multiplicidad Origen</label>
            <select
              style={styles.input}
              value={relacionSeleccionada.multiplicidadOrigen}
              onChange={(e) => setRelacionSeleccionada({ ...relacionSeleccionada, multiplicidadOrigen: e.target.value })}
            >
              <option value="1">1</option>
              <option value="*">*</option>
              <option value="0..1">0..1</option>
              <option value="1..*">1..*</option>
              <option value="0..*">0..*</option>
              <option value="2..5">2..5</option>
            </select>

            <label style={styles.label}>Multiplicidad Destino</label>
            <select
              style={styles.input}
              value={relacionSeleccionada.multiplicidadDestino}
              onChange={(e) => setRelacionSeleccionada({ ...relacionSeleccionada, multiplicidadDestino: e.target.value })}
            >
              <option value="1">1</option>
              <option value="*">*</option>
              <option value="0..1">0..1</option>
              <option value="1..*">1..*</option>
              <option value="0..*">0..*</option>
              <option value="2..5">2..5</option>
            </select>

            <div style={styles.botones}>
              <button
                type="button"
                style={styles.botonEliminarRelacion}
                onClick={() => {
                  if (!window.confirm("¿Eliminar esta relación?")) return;
                  socket.emit("relacion:eliminar", {
                    diagramaId,
                    relacionId: relacionSeleccionada.id,
                  });
                  setMostrarModalRelacion(false);
                  setRelacionSeleccionada(null);
                }}
              >
                Eliminar relación
              </button>
              <button
                type="button"
                style={styles.botonCancelar}
                onClick={() => {
                  setMostrarModalRelacion(false);
                  setRelacionSeleccionada(null);
                }}
              >
                Cancelar
              </button>
              <button type="button" style={styles.botonCrear} onClick={guardarRelacion}>
                Guardar
              </button>
            </div>
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
  listaAtributos: { marginBottom: "1rem", maxHeight: "180px", overflowY: "auto" },
  atributoItem: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
    padding: "0.5rem", borderBottom: "1px solid #eee", fontSize: "0.9rem",
  },
  botonEliminarAtributo: {
    padding: "0.3rem 0.5rem", backgroundColor: "#e63946", color: "white",
    border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem",
  },
  sinAtributos: { color: "#888", fontSize: "0.85rem", margin: "0 0 0.75rem" },
  botones: { display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" },
  botonCancelar: {
    padding: "0.6rem 1rem", backgroundColor: "transparent", color: "#666",
    border: "1px solid #ddd", borderRadius: "4px", cursor: "pointer",
  },
  botonEliminarRelacion: {
    padding: "0.6rem 1rem", backgroundColor: "#e63946", color: "white",
    border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600,
    marginRight: "auto",
  },
  botonCrear: {
    padding: "0.6rem 1.25rem", backgroundColor: "#4361ee", color: "white",
    border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600,
  },
};