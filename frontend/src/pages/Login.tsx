import { useState } from "react";

interface Props {
  onLogin: (token: string, usuario: { id: string; nombre: string; email: string }) => void;
}

export default function Login({ onLogin }: Props) {
  const [modo, setModo] = useState<"login" | "registro">("login");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCargando(true);

    try {
      const url = modo === "login" ? "/auth/login" : "/auth/registro";
      const body: Record<string, string> = modo === "login"
        ? { email, contrasena }
        : { nombre, email, contrasena };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error desconocido");
        return;
      }

      if (modo === "registro") {
        setModo("login");
        setError("");
        alert("Registro exitoso. Ahora inicia sesión.");
        return;
      }

      onLogin(data.token, data.usuario);
    } catch {
      setError("Error de conexión con el servidor");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div style={styles.contenedor}>
      <div style={styles.tarjeta}>
        <h1 style={styles.titulo}>Diagramador Colaborativo UML</h1>
        <h2 style={styles.subtitulo}>{modo === "login" ? "Iniciar Sesión" : "Registrarse"}</h2>

        <form onSubmit={enviar}>
          {modo === "registro" && (
            <input
              style={styles.input}
              type="text"
              placeholder="Nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
            />
          )}
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Contraseña"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            required
          />

          {error && <p style={styles.error}>{error}</p>}

          <button style={styles.boton} type="submit" disabled={cargando}>
            {cargando ? "Cargando..." : modo === "login" ? "Iniciar Sesión" : "Registrarse"}
          </button>
        </form>

        <p style={styles.toggle}>
          {modo === "login" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
          <button
            style={styles.botonToggle}
            onClick={() => {
              setModo(modo === "login" ? "registro" : "login");
              setError("");
            }}
          >
            {modo === "login" ? "Registrarse" : "Iniciar Sesión"}
          </button>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  contenedor: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0f2f5",
    fontFamily: "system-ui, sans-serif",
  },
  tarjeta: {
    backgroundColor: "white",
    padding: "2rem",
    borderRadius: "8px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
    width: "100%",
    maxWidth: "400px",
  },
  titulo: {
    margin: "0 0 0.5rem",
    fontSize: "1.5rem",
    color: "#1a1a2e",
    textAlign: "center",
  },
  subtitulo: {
    margin: "0 0 1.5rem",
    fontSize: "1rem",
    color: "#666",
    textAlign: "center",
    fontWeight: "normal",
  },
  input: {
    width: "100%",
    padding: "0.75rem",
    marginBottom: "0.75rem",
    border: "1px solid #ddd",
    borderRadius: "4px",
    fontSize: "1rem",
    boxSizing: "border-box",
  },
  boton: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: "#4361ee",
    color: "white",
    border: "none",
    borderRadius: "4px",
    fontSize: "1rem",
    cursor: "pointer",
  },
  error: {
    color: "#e63946",
    fontSize: "0.875rem",
    marginBottom: "0.75rem",
  },
  toggle: {
    textAlign: "center",
    marginTop: "1rem",
    fontSize: "0.875rem",
    color: "#666",
  },
  botonToggle: {
    background: "none",
    border: "none",
    color: "#4361ee",
    cursor: "pointer",
    fontSize: "0.875rem",
    textDecoration: "underline",
  },
};
