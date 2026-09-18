-- CreateEnum
CREATE TYPE "TipoDiagrama" AS ENUM ('CLASES', 'ENTIDAD_RELACION');

-- CreateEnum
CREATE TYPE "RolColaborador" AS ENUM ('PROPIETARIO', 'COLABORADOR', 'VISUALIZADOR');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contrasenaHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagrama" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo" "TipoDiagrama" NOT NULL,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaModificacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Diagrama_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Colaboracion" (
    "id" TEXT NOT NULL,
    "rol" "RolColaborador" NOT NULL,
    "fechaInvitacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "diagramaId" TEXT NOT NULL,

    CONSTRAINT "Colaboracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementoDiagrama" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "posicionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posicionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diagramaId" TEXT NOT NULL,

    CONSTRAINT "ElementoDiagrama_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Atributo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoDato" TEXT NOT NULL,
    "visibilidad" TEXT,
    "elementoDiagramaId" TEXT NOT NULL,

    CONSTRAINT "Atributo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelacionUML" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "multiplicidadOrigen" TEXT,
    "multiplicidadDestino" TEXT,
    "origenId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,

    CONSTRAINT "RelacionUML_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroSesion" (
    "id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "marcaTiempo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "RegistroSesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComandoVoz" (
    "id" TEXT NOT NULL,
    "textoOriginal" TEXT NOT NULL,
    "accionInterpretada" TEXT NOT NULL,
    "exito" BOOLEAN NOT NULL DEFAULT false,
    "marcaTiempo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "ComandoVoz_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Colaboracion_usuarioId_diagramaId_key" ON "Colaboracion"("usuarioId", "diagramaId");

-- AddForeignKey
ALTER TABLE "Colaboracion" ADD CONSTRAINT "Colaboracion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Colaboracion" ADD CONSTRAINT "Colaboracion_diagramaId_fkey" FOREIGN KEY ("diagramaId") REFERENCES "Diagrama"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementoDiagrama" ADD CONSTRAINT "ElementoDiagrama_diagramaId_fkey" FOREIGN KEY ("diagramaId") REFERENCES "Diagrama"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atributo" ADD CONSTRAINT "Atributo_elementoDiagramaId_fkey" FOREIGN KEY ("elementoDiagramaId") REFERENCES "ElementoDiagrama"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelacionUML" ADD CONSTRAINT "RelacionUML_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "ElementoDiagrama"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelacionUML" ADD CONSTRAINT "RelacionUML_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "ElementoDiagrama"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroSesion" ADD CONSTRAINT "RegistroSesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComandoVoz" ADD CONSTRAINT "ComandoVoz_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
