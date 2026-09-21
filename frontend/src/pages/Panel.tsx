import { Component, ErrorInfo, ReactNode, useState, useEffect } from "react";

interface Diagrama {
  id: string;
  titulo: string;
  tipo: string;
  fechaModificacion: string;
  colaboraciones: { rol: string; usuario: { id: string; nombre: string } }[];
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Error al renderizar la lista de diagramas", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <p style={styles.vacio}>No se pudo cargar la lista de diagramas.</p>;
    }

    return this.props.children;
  }
}

interface Props {
  usuario: { id: string; nombre: string; email: string };
  token: string;
  onLogout: () => void;
  onAbrirDiagrama: (id: string) => void;
}

export default function Panel({ usuario, token, onLogout, onAbrirDiagrama }: Props) {
  const [diagramas, setDiagramas] = useState<Diagrama[]>([]);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [tipo, setTipo] = useState<"clases" | "ER">("clases");
  const [titulo, setTitulo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const cargarDiagramas = async () => {
    const res = await fetch("/diagramas", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setDiagramas(await res.json());
  };

  useEffect(() => {
    cargarDiagramas();
  }, []);

  const crearDiagrama = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError("");

    const res = await fetch("/diagramas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tipo, titulo: titulo || undefined }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Error al crear diagrama");
      setCargando(false);
      return;
    }

    const nuevo = await res.json();
    await cargarDiagramas();
    onAbrirDiagrama(nuevo.id);
    setMostrarModal(false);
    setTitulo("");
    setTipo("clases");
    setCargando(false);
  };

  return (
    <div style={styles.contenedor}>
      <header style={styles.header}>
        <h1 style={styles.titulo}>Diagramador Colaborativo UML</h1>
        <div style={styles.usuarioInfo}>
          <span style={styles.usuario}>{usuario.nombre}</span>
          <button style={styles.botonLogout} onClick={onLogout}>
            Cerrar Sesión
          </button>
        </div>
      </header>
      <main style={styles.main}>
        <div style={styles.fila}>
          <p style={styles.bienvenida}>
            Bienvenido, <strong>{usuario.nombre}</strong>
          </p>
          <button style={styles.botonNuevo} onClick={() => setMostrarModal(true)}>
            + Nuevo diagrama
          </button>
        </div>

        {diagramas.length === 0 ? (
          <p style={styles.vacio}>No tienes diagramas aún. Crea uno para comenzar.</p>
        ) : (
          <ErrorBoundary>
            <div style={styles.lista}>
              {diagramas.map((d) => {
                const soyPropietario = (d.colaboraciones || []).some(
                  (c) => c?.usuario?.id === usuario.id && c?.rol === "PROPIETARIO"
                );

                return (
                  <div key={d.id} style={styles.tarjeta} onClick={() => onAbrirDiagrama(d.id)}>
                    <div style={styles.tarjetaHeader}>
                      <span style={styles.tipoBadge}>
                        {d.tipo === "CLASES" ? "Clases" : "Entidad-Relación"}
                      </span>
                      <div style={styles.tarjetaAcciones}>
                        <span style={styles.fecha}>
                          {new Date(d.fechaModificacion).toLocaleDateString("es-PE")}
                        </span>
                        {soyPropietario && (
                          <button
                            type="button"
                            style={styles.botonEliminar}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm(`¿Eliminar el diagrama "${d.titulo}"? Esta acción no se puede deshacer.`)) {
                                return;
                              }

                              const respuesta = await fetch(`/diagramas/${d.id}`, {
                                method: "DELETE",
                                headers: { Authorization: `Bearer ${token}` },
                              });

                              if (respuesta.ok) {
                                await cargarDiagramas();
                              } else if (respuesta.status === 403) {
                                alert("Solo el propietario puede eliminar el diagrama");
                              } else {
                                alert("Error al eliminar el diagrama");
                              }
                            }}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </div>
                    <h3 style={styles.tarjetaTitulo}>{d.titulo}</h3>
                    <p style={styles.tarjetaColabs}>
                      {(d.colaboraciones || []).map((c) => c?.usuario?.nombre).filter(Boolean).join(", ") || "Sin colaboradores"}
                    </p>
                  </div>
                );
              })}
            </div>
          </ErrorBoundary>
        )}
      </main>

      {mostrarModal && (
        <div style={styles.overlay} onClick={() => setMostrarModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitulo}>Nuevo Diagrama</h2>
            <form onSubmit={crearDiagrama}>
              <label style={styles.label}>Tipo</label>
              <select
                style={styles.select}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "clases" | "ER")}
              >
                <option value="clases">Diagrama de Clases</option>
                <option value="ER">Entidad-Relación</option>
              </select>

              <label style={styles.label}>Título (opcional)</label>
              <input
                style={styles.input}
                type="text"
                placeholder="Diagrama sin título"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />

              {error && <p style={styles.error}>{error}</p>}

              <div style={styles.botones}>
                <button type="button" style={styles.botonCancelar} onClick={() => setMostrarModal(false)}>
                  Cancelar
                </button>
                <button type="submit" style={styles.botonCrear} disabled={cargando}>
                  {cargando ? "Creando..." : "Crear"}
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
  titulo: { margin: 0, fontSize: "1.25rem" },
  usuarioInfo: { display: "flex", alignItems: "center", gap: "1rem" },
  usuario: { fontSize: "0.875rem", opacity: 0.9 },
  botonLogout: {
    padding: "0.5rem 1rem", backgroundColor: "transparent", color: "white",
    border: "1px solid rgba(255,255,255,0.3)", borderRadius: "4px", cursor: "pointer", fontSize: "0.875rem",
  },
  main: { padding: "2rem" },
  fila: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" },
  bienvenida: { fontSize: "1.125rem", color: "#333", margin: 0 },
  botonNuevo: {
    padding: "0.75rem 1.25rem", backgroundColor: "#4361ee", color: "white",
    border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.95rem", fontWeight: 600,
  },
  vacio: { color: "#888", fontSize: "1rem", textAlign: "center", marginTop: "3rem" },
  lista: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" },
  tarjeta: {
    backgroundColor: "white", borderRadius: "8px", padding: "1.25rem",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer",
    transition: "box-shadow 0.15s",
  },
  tarjetaHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" },
  tarjetaAcciones: { display: "flex", alignItems: "center", gap: "0.5rem" },
  tipoBadge: {
    fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
    backgroundColor: "#e8eaf6", color: "#3949ab", fontWeight: 600,
  },
  fecha: { fontSize: "0.75rem", color: "#999" },
  botonEliminar: {
    backgroundColor: "#ffe5e5", color: "#e63946", padding: "0.25rem 0.5rem",
    borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer", border: "none",
  },
  tarjetaTitulo: { margin: "0 0 0.5rem", fontSize: "1rem", color: "#1a1a2e" },
  tarjetaColabs: { margin: 0, fontSize: "0.8rem", color: "#888" },
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
  select: {
    width: "100%", padding: "0.6rem", marginBottom: "1rem", border: "1px solid #ddd",
    borderRadius: "4px", fontSize: "0.95rem", boxSizing: "border-box",
  },
  input: {
    width: "100%", padding: "0.6rem", marginBottom: "1rem", border: "1px solid #ddd",
    borderRadius: "4px", fontSize: "0.95rem", boxSizing: "border-box",
  },
  error: { color: "#e63946", fontSize: "0.85rem", marginBottom: "0.75rem" },
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
