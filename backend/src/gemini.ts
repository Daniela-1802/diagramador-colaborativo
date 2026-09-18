import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ResultadoComando {
  accion:
    | "crear_clase"
    | "mover_elemento"
    | "eliminar_clase"
    | "renombrar_clase"
    | "crear_relacion"
    | "desconocido"
    | "error_conexion";
  nombre?: string;
  direccion?: string;
  nuevoNombre?: string;
  origen?: string;
  destino?: string;
  tipo?: string;
  multiplicidad?: string;
}

const instruccionSistema = `Eres un asistente de IA para un editor UML en español. Tu objetivo es deducir la INTENCIÓN del usuario y responder ÚNICAMENTE un JSON.

Acciones soportadas:
1. CREAR CLASE: (crear, agregar, poner, dibuja)
  Ej: 'crear clase Producto' -> {"accion": "crear_clase", "nombre": "Producto"}

2. MOVER ELEMENTO: (mover, subir, bajar, desplazar, reubicar)
  Direcciones: 'arriba', 'abajo', 'izquierda', 'derecha'.
  Ej: 'mover usuario arriba' -> {"accion": "mover_elemento", "nombre": "usuario", "direccion": "arriba"}

3. ELIMINAR ELEMENTO:
  - Intenciones: eliminar, borrar, quitar, remover, sacar.
  - Ejemplo: 'borra la clase Usuario' -> {"accion": "eliminar_clase", "nombre": "Usuario"}

4. RENOMBRAR ELEMENTO:
  - Intenciones: renombrar, cambiar el nombre, ponerle otro nombre.
  - Ejemplo: 'renombra Usuario a Cliente' -> {"accion": "renombrar_clase", "nombre": "Usuario", "nuevoNombre": "Cliente"}

5. CREAR RELACIÓN: (relacionar, conectar, vincular, asociar)
  Tipos: 'asociacion', 'agregacion', 'composicion', 'herencia'.
  Multiplicidad: '1', '0..*', '1..*', etc.
  Ej: 'relacionar Usuario con Pedido, uno a muchos' -> {"accion": "crear_relacion", "origen": "Usuario", "destino": "Pedido", "multiplicidad": "1..*"}

Si no se reconoce la intención: {"accion": "desconocido"}.`;

const espera = (milisegundos: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milisegundos));

const esErrorReintentable = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;

  const posibleError = error as { status?: number; statusCode?: number; code?: string; message?: string };
  const mensaje = posibleError.message?.toLowerCase() || "";
  return (
    posibleError.status === 503 ||
    posibleError.statusCode === 503 ||
    posibleError.code === "ECONNRESET" ||
    posibleError.code === "ETIMEDOUT" ||
    posibleError.code === "ENOTFOUND" ||
    mensaje.includes("network") ||
    mensaje.includes("fetch failed") ||
    mensaje.includes("503")
  );
};

const interpretarConModelo = async (modelo: string, texto: string): Promise<ResultadoComando> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { accion: "error_conexion" };

  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model: modelo,
    systemInstruction: instruccionSistema,
    generationConfig: { responseMimeType: "application/json" },
  });

  const result = await generativeModel.generateContent(texto);
  const respuesta = JSON.parse(result.response.text()) as Partial<ResultadoComando>;

  if (
    respuesta.accion !== "crear_clase" &&
    respuesta.accion !== "mover_elemento" &&
    respuesta.accion !== "eliminar_clase" &&
    respuesta.accion !== "renombrar_clase" &&
    respuesta.accion !== "crear_relacion" &&
    respuesta.accion !== "desconocido"
  ) {
    return { accion: "desconocido" };
  }

  return {
    accion: respuesta.accion,
    ...(typeof respuesta.nombre === "string" ? { nombre: respuesta.nombre } : {}),
    ...(typeof respuesta.direccion === "string" ? { direccion: respuesta.direccion } : {}),
    ...(typeof respuesta.nuevoNombre === "string" ? { nuevoNombre: respuesta.nuevoNombre } : {}),
    ...(typeof respuesta.origen === "string" ? { origen: respuesta.origen } : {}),
    ...(typeof respuesta.destino === "string" ? { destino: respuesta.destino } : {}),
    ...(typeof respuesta.tipo === "string" ? { tipo: respuesta.tipo } : {}),
    ...(typeof respuesta.multiplicidad === "string" ? { multiplicidad: respuesta.multiplicidad } : {}),
  };
};


export async function interpretarComando(texto: string): Promise<ResultadoComando> {
  const esperas = [1000, 2000, 4000];

  for (let intento = 0; intento < 3; intento += 1) {
    try {
      return await interpretarConModelo("gemini-3.5-flash-lite", texto);
    } catch (error) {
      if (!esErrorReintentable(error)) break;
      if (intento < esperas.length) await espera(esperas[intento]);
    }
  }

  try {
    return await interpretarConModelo("gemini-3.5-flash-lite", texto);
  } catch {
    return { accion: "error_conexion" };
  }
}