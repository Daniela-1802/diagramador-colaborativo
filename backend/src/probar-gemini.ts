import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("Error: GEMINI_API_KEY no está definida en las variables de entorno.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function ejecutarPrueba() {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = 'Responde solo con JSON así: {"accion": "crear_clase", "nombre": "Usuario"} si el usuario dice: crear clase Usuario';

    const result = await model.generateContent(prompt);
    console.log("--- RESPUESTA DE GEMINI ---");
    console.log(result.response.text());
    console.log("---------------------------");
  } catch (error) {
    console.error("Error al conectar con Gemini:", error);
  }
}

ejecutarPrueba();