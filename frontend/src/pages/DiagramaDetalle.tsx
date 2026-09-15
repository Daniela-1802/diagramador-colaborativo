import { useState, useEffect } from "react";

interface Colaborador {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: string;
  fechaInvitacion: string;
}

interface DiagramaDetalle {
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
    atributos: { nombre: string; tipoDato: string; visibilidad: string | null }[];
  }[];
}

interface Props {
  diagramaId: string;
  token: string;
  onVolver: () => void;
}

export default function DiagramaDetalle({ diagramaId, token, onVolver }: Props) {
  const [diagrama, setDiagrama] = useState<DiagramaDetalle | null>(null);
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [error, setError] = useState("");
  const [mostrarModal, setMostrarModal] = useState(false);
  const [emailInvitar, setEmailInvitar] = useState("");
  const [errorInvitacion, setErrorInvitacion] = useState("");
  const [exitoInvitacion, setExitoInvitacion] = useState("");
  const [cargandoInvitacion, setCargandoInvitacion] = useState(false);

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
          <h2 style={styles.seccionTitulo}>Elementos ({diagrama.elementos.length})</h2>
          {diagrama.elementos.length === 0 ? (
            <p style={styles.vacio}>No hay elementos aún. Próximamente se podrá agregar el canvas de diagramas.</p>
          ) : (
            <ul style={styles.lista}>
              {diagrama.elementos.map((el) => (
                <li key={el.id} style={styles.listaItem}>
                  <strong>{el.nombre}</strong>
                  <span style={styles.rol}>{el.tipo}</span>
                  {el.atributos.length > 0 && (
                    <span style={styles.attrCount}>({el.atributos.length} atributos)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
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
  main: { padding: "2rem", maxWidth: "800px", margin: "0 auto" },
  seccion: { marginBottom: "2rem" },
  filaTitulo: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" },
  seccionTitulo: { fontSize: "1.1rem", color: "#1a1a2e", margin: 0 },
  botonInvitar: {
    padding: "0.5rem 1rem", backgroundColor: "#4361ee", color: "white",
    border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600,
  },
  lista: { listStyle: "none", padding: 0, margin: 0 },
  listaItem: {
    backgroundColor: "white", padding: "0.75rem 1rem", marginBottom: "0.5rem",
    borderRadius: "6px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    display: "flex", alignItems: "center", gap: "0.75rem",
  },
  email: { fontSize: "0.8rem", color: "#888" },
  rol: { fontSize: "0.8rem", color: "#4361ee", fontWeight: 500 },
  attrCount: { fontSize: "0.8rem", color: "#999" },
  vacio: { color: "#888", fontSize: "0.95rem" },
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
