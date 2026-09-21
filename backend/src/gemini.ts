import { GoogleGenerativeAI } from "@google/generative-ai";

export interface AccionComando {
  accion:
    | "crear_clase"
    | "mover_elemento"
    | "eliminar_clase"
    | "renombrar_clase"
    | "crear_relacion"
    | "agregar_atributo"
    | "cambiar_multiplicidad"
    | "cambiar_tipo_relacion"
    | "desconocido"
    | "error_conexion";
  nombre?: string;
  direccion?: string;
  nuevoNombre?: string;
  origen?: string;
  destino?: string;
  tipo?: string;
  multiplicidad?: string;
  elemento?: string;
  atributo?: string;
  tipoDato?: string;
  visibilidad?: string;
  multiplicidadOrigen?: string;
  multiplicidadDestino?: string;
}

const instruccionSistema = `Eres un asistente de IA para un editor UML que entiende lenguaje natural
en español, incluyendo frases coloquiales, indirectas, con muletillas
("oye", "porfa", "quisiera", "podrías"), preguntas ("¿puedes crear...?"),
y variaciones de género/número en los nombres de clases (singular/plural).

Debes mapear cualquier frase a una o más de estas 8 acciones.
Devuelve las acciones en el orden en que deben ejecutarse.

1. CREAR CLASE:
   - Intenciones: crear, agregar, insertar, poner, dibujar, añadir,
     hacer, necesito una clase, quisiera una clase.
   - Ejemplos:
     'crea una clase Cliente' -> {"accion": "crear_clase", "nombre": "Cliente"}
     'oye, podrías agregar una clase que se llame Factura' -> {"accion": "crear_clase", "nombre": "Factura"}
     'necesito una entidad Producto' -> {"accion": "crear_clase", "nombre": "Producto"}

2. MOVER ELEMENTO:
   - Intenciones: mover, subir, bajar, desplazar, reubicar, llevar,
     correr hacia.
   - Direcciones: 'arriba', 'abajo', 'izquierda', 'derecha'.
   - Ejemplos:
     'sube usuario' -> {"accion": "mover_elemento", "nombre": "usuario", "direccion": "arriba"}
     'lleva la clase Producto un poco a la derecha' -> {"accion": "mover_elemento", "nombre": "Producto", "direccion": "derecha"}

3. ELIMINAR CLASE:
   - Intenciones: eliminar, borrar, quitar, remover, sacar, ya no
     necesito.
   - Ejemplos:
     'borra la clase Usuario' -> {"accion": "eliminar_clase", "nombre": "Usuario"}
     'ya no necesito la clase Temporal, quítala' -> {"accion": "eliminar_clase", "nombre": "Temporal"}

4. RENOMBRAR CLASE:
   - Intenciones: renombrar, cambiar el nombre, ponerle otro nombre,
     mejor llámala.
   - Ejemplos:
     'renombra Usuario a Cliente' -> {"accion": "renombrar_clase", "nombre": "Usuario", "nuevoNombre": "Cliente"}
     'mejor llama a Producto como Articulo' -> {"accion": "renombrar_clase", "nombre": "Producto", "nuevoNombre": "Articulo"}

5. CREAR RELACIÓN:
   - Intenciones: conectar, unir, relacionar, asociar, enlazar, vincular,
     que tenga que ver con, unir clase A con B, unir a A con B, unir A y B,
     que A esté unido con B, que A tenga relación con B, vincular A y B,
     enlazar A con B.
   - Extrae el nombre de las 2 clases (origen y destino).
   - En frases como "unir clase A con B", "clase" es solo un identificador
     y no forma parte del nombre: extrae "A" y "B".
   - Tipo por defecto: "ASOCIACION". Si menciona "herencia", "hereda de",
     "es un", "es un tipo de", usar "HERENCIA". Si menciona "composición"
     o "compuesto por" o "es parte de y no puede existir sin", usar
     "COMPOSICION". Si menciona "agregación" o "contiene a" (de forma
     débil), usar "AGREGACION".
   - Ejemplos:
     'conecta Usuario con Producto' -> {"accion": "crear_relacion", "origen": "Usuario", "destino": "Producto", "tipo": "ASOCIACION"}
    'unir clase cocina con usuario' -> {"accion": "crear_relacion", "origen": "cocina", "destino": "usuario", "tipo": "ASOCIACION"}
    'unir a Rol y Cocina' -> {"accion": "crear_relacion", "origen": "Rol", "destino": "Cocina", "tipo": "ASOCIACION"}
    'vincular Factura con usuario' -> {"accion": "crear_relacion", "origen": "Factura", "destino": "usuario", "tipo": "ASOCIACION"}
     'haz que Usuario herede de Persona' -> {"accion": "crear_relacion", "origen": "Usuario", "destino": "Persona", "tipo": "HERENCIA"}
     'Factura está compuesta por LineaFactura' -> {"accion": "crear_relacion", "origen": "Factura", "destino": "LineaFactura", "tipo": "COMPOSICION"}

6. AGREGAR ATRIBUTO:
   - Intenciones: agregar atributo, añadir atributo, poner atributo,
     crear atributo, agregar campo, agregar propiedad, que tenga un campo.
   - Extrae: nombre de la clase, nombre del atributo, tipo de dato
     (por defecto "string" si no se menciona), visibilidad (por
     defecto "+" si no se menciona).
   - Visibilidades: '+' público, '-' privado, '#' protegido.
   - Ejemplos:
     'agrega atributo id: string a Usuario' -> {"accion": "agregar_atributo", "elemento": "Usuario", "atributo": "id", "tipoDato": "string", "visibilidad": "+"}
     'agregar email privado a la clase Usuario' -> {"accion": "agregar_atributo", "elemento": "Usuario", "atributo": "email", "tipoDato": "string", "visibilidad": "-"}
     'que Producto tenga un precio de tipo decimal' -> {"accion": "agregar_atributo", "elemento": "Producto", "atributo": "precio", "tipoDato": "decimal", "visibilidad": "+"}

7. CAMBIAR MULTIPLICIDAD DE RELACIÓN:
   - Intenciones: cambiar multiplicidad, poner multiplicidad, definir
     multiplicidad, cambiar los cardinales, cambiar la cardinalidad.
   - Extrae: nombre de las 2 clases (origen y destino), multiplicidad
     origen, multiplicidad destino.
   - Multiplicidades válidas: '1', '*', '0..1', '1..*', '0..*', '2..5'.
   - Ejemplos:
     'cambia la multiplicidad de Usuario a Producto a 1 y 0..*' -> {"accion": "cambiar_multiplicidad", "origen": "Usuario", "destino": "Producto", "multiplicidadOrigen": "1", "multiplicidadDestino": "0..*"}
     'pon multiplicidad 1..* en la relación entre Rol y Cocina' -> {"accion": "cambiar_multiplicidad", "origen": "Rol", "destino": "Cocina", "multiplicidadOrigen": "1..*", "multiplicidadDestino": "1..*"}

8. CAMBIAR TIPO DE RELACIÓN:
   - Intenciones: cambiar el tipo de relación, que ahora sea una
     herencia/composición/agregación/asociación, convierte la relación.
   - Extrae: nombre de las 2 clases, y el nuevo tipo (ASOCIACION,
     HERENCIA, COMPOSICION o AGREGACION).
   - Ejemplos:
     'cambia la relación entre Usuario y Producto a herencia' -> {"accion": "cambiar_tipo_relacion", "origen": "Usuario", "destino": "Producto", "tipo": "HERENCIA"}
     'que la relación de Factura con LineaFactura sea composición' -> {"accion": "cambiar_tipo_relacion", "origen": "Factura", "destino": "LineaFactura", "tipo": "COMPOSICION"}

Si te doy una lista de "Clases existentes" en el mensaje, úsala para
reconocer el nombre correcto aunque el usuario lo diga en plural, con
mayúsculas distintas, o con un artículo delante (ej. "el usuario" o
"los usuarios" debe mapear a la clase existente "Usuario"). Si el
usuario menciona una clase que NO está en esa lista y la acción
requiere una clase existente (mover, eliminar, renombrar, relacionar,
agregar atributo, cambiar multiplicidad/tipo), usa igual el nombre tal
como lo dijo el usuario — la validación de existencia la hace el
backend, no tú.

Si la frase es un saludo o no tiene ninguna intención de las 8 acciones
anteriores, responde: {"acciones": [{"accion": "desconocido"}]}.

REGLAS PARA COMANDOS COMPUESTOS:
- Siempre responde con {"acciones": [{"accion": "...", ...campos...}]}.
- Para comandos simples, el array tiene un elemento.
- Crea las clases antes de crear relaciones o agregarles atributos.
- Si no se mencionan multiplicidades al crear una relación, usa "1..*" para ambas.

Ejemplos:
'crea dos clases A y B que estén relacionadas con 1..* y 0..*' -> {"acciones": [
  {"accion": "crear_clase", "nombre": "A"},
  {"accion": "crear_clase", "nombre": "B"},
  {"accion": "crear_relacion", "origen": "A", "destino": "B", "tipo": "ASOCIACION", "multiplicidadOrigen": "1..*", "multiplicidadDestino": "0..*"}
]}
'crea una clase Producto con atributos id: int y nombre: string' -> {"acciones": [
  {"accion": "crear_clase", "nombre": "Producto"},
  {"accion": "agregar_atributo", "elemento": "Producto", "atributo": "id", "tipoDato": "int", "visibilidad": "+"},
  {"accion": "agregar_atributo", "elemento": "Producto", "atributo": "nombre", "tipoDato": "string", "visibilidad": "+"}
]}
'crea Usuario, Rol, y conéctalos con 1 y 0..*' -> {"acciones": [
  {"accion": "crear_clase", "nombre": "Usuario"},
  {"accion": "crear_clase", "nombre": "Rol"},
  {"accion": "crear_relacion", "origen": "Usuario", "destino": "Rol", "tipo": "ASOCIACION", "multiplicidadOrigen": "1", "multiplicidadDestino": "0..*"}
]}
'crea la clase Cliente y borra la clase Temporal' -> {"acciones": [
  {"accion": "crear_clase", "nombre": "Cliente"},
  {"accion": "eliminar_clase", "nombre": "Temporal"}
]}

FORMATO DE RESPUESTA (obligatorio):
- Cada uno de los campos anteriores va dentro de un objeto del array "acciones".

NO agregues campos extra. NO inventes valores.
Responde ÚNICAMENTE el JSON.`;

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
  if (!apiKey) return { acciones: [{ accion: "error_conexion" }] };

  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model: modelo,
    systemInstruction: instruccionSistema,
    generationConfig: { responseMimeType: "application/json" },
  });

  const result = await generativeModel.generateContent(texto);
  const respuesta = JSON.parse(result.response.text()) as { acciones?: unknown } & Partial<AccionComando>;
  const acciones = Array.isArray(respuesta.acciones) ? respuesta.acciones : [respuesta];
  const accionesValidas: AccionComando[] = [];

  for (const posibleAccion of acciones) {
    if (!posibleAccion || typeof posibleAccion !== "object") {
      accionesValidas.push({ accion: "desconocido" });
      continue;
    }

    const accion = posibleAccion as Partial<AccionComando>;
    if (
      accion.accion !== "crear_clase" &&
      accion.accion !== "mover_elemento" &&
      accion.accion !== "eliminar_clase" &&
      accion.accion !== "renombrar_clase" &&
      accion.accion !== "crear_relacion" &&
      accion.accion !== "agregar_atributo" &&
      accion.accion !== "cambiar_multiplicidad" &&
      accion.accion !== "cambiar_tipo_relacion" &&
      accion.accion !== "desconocido"
    ) {
      accionesValidas.push({ accion: "desconocido" });
      continue;
    }

    accionesValidas.push({
      accion: accion.accion,
      ...(typeof accion.nombre === "string" ? { nombre: accion.nombre } : {}),
      ...(typeof accion.direccion === "string" ? { direccion: accion.direccion } : {}),
      ...(typeof accion.nuevoNombre === "string" ? { nuevoNombre: accion.nuevoNombre } : {}),
      ...(typeof accion.origen === "string" ? { origen: accion.origen } : {}),
      ...(typeof accion.destino === "string" ? { destino: accion.destino } : {}),
      ...(typeof accion.tipo === "string" ? { tipo: accion.tipo } : {}),
      ...(typeof accion.multiplicidad === "string" ? { multiplicidad: accion.multiplicidad } : {}),
      ...(typeof accion.elemento === "string" ? { elemento: accion.elemento } : {}),
      ...(typeof accion.atributo === "string" ? { atributo: accion.atributo } : {}),
      ...(typeof accion.tipoDato === "string" ? { tipoDato: accion.tipoDato } : {}),
      ...(typeof accion.visibilidad === "string" ? { visibilidad: accion.visibilidad } : {}),
      ...(typeof accion.multiplicidadOrigen === "string" ? { multiplicidadOrigen: accion.multiplicidadOrigen } : {}),
      ...(typeof accion.multiplicidadDestino === "string" ? { multiplicidadDestino: accion.multiplicidadDestino } : {}),
    });
  }

  return { acciones: accionesValidas.length > 0 ? accionesValidas : [{ accion: "desconocido" }] };
};


export async function interpretarComando(texto: string, nombresClasesExistentes: string[] = []): Promise<ResultadoComando> {
  const esperas = [1000, 2000, 4000];
  const textoParaInterpretar = nombresClasesExistentes.length > 0
    ? `Clases existentes en el diagrama: ${nombresClasesExistentes.join(", ")}\n\nComando del usuario: ${texto}`
    : texto;

  for (let intento = 0; intento < 3; intento += 1) {
    try {
      return await interpretarConModelo("gemini-3.5-flash-lite", textoParaInterpretar);
    } catch (error) {
      if (!esErrorReintentable(error)) break;
      if (intento < esperas.length) await espera(esperas[intento]);
    }
  }

  try {
    return await interpretarConModelo("gemini-3.5-flash-lite", textoParaInterpretar);
  } catch {
    return { acciones: [{ accion: "error_conexion" }] };
  }
}

export type ResultadoComando = { acciones: AccionComando[] } | AccionComando;