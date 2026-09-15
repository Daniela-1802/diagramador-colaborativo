import { useState } from "react";
import Login from "./pages/Login";
import Panel from "./pages/Panel";
import DiagramaDetalle from "./pages/DiagramaDetalle";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<{ id: string; nombre: string; email: string } | null>(null);
  const [diagramaAbierto, setDiagramaAbierto] = useState<string | null>(null);

  const manejarLogin = (nuevoToken: string, nuevoUsuario: { id: string; nombre: string; email: string }) => {
    setToken(nuevoToken);
    setUsuario(nuevoUsuario);
  };

  const manejarLogout = () => {
    setToken(null);
    setUsuario(null);
    setDiagramaAbierto(null);
  };

  if (!token || !usuario) {
    return <Login onLogin={manejarLogin} />;
  }

  if (diagramaAbierto) {
    return (
      <DiagramaDetalle
        diagramaId={diagramaAbierto}
        token={token}
        onVolver={() => setDiagramaAbierto(null)}
      />
    );
  }

  return (
    <Panel
      usuario={usuario}
      token={token}
      onLogout={manejarLogout}
      onAbrirDiagrama={setDiagramaAbierto}
    />
  );
}
