-- CreateTable
CREATE TABLE "MensajesChat" (
    "id" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "esIA" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "diagramaId" TEXT NOT NULL,

    CONSTRAINT "MensajesChat_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MensajesChat" ADD CONSTRAINT "MensajesChat_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MensajesChat" ADD CONSTRAINT "MensajesChat_diagramaId_fkey" FOREIGN KEY ("diagramaId") REFERENCES "Diagrama"("id") ON DELETE CASCADE ON UPDATE CASCADE;
