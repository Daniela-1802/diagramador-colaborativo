import { PrismaClient, RolColaborador } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("123456", 10);

  const juan = await prisma.usuario.upsert({
    where: { email: "juan@test.com" },
    update: {},
    create: {
      nombre: "Juan",
      email: "juan@test.com",
      contrasenaHash: hash,
    },
  });

  const maria = await prisma.usuario.upsert({
    where: { email: "maria@test.com" },
    update: {},
    create: {
      nombre: "Maria",
      email: "maria@test.com",
      contrasenaHash: hash,
    },
  });

  const diagrama = await prisma.diagrama.upsert({
    where: { id: "diagrama-test-001" },
    update: {},
    create: {
      id: "diagrama-test-001",
      titulo: "Diagrama de prueba",
      tipo: "CLASES",
      colaboraciones: {
        create: {
          usuarioId: juan.id,
          rol: RolColaborador.PROPIETARIO,
        },
      },
    },
  });

  await prisma.colaboracion.upsert({
    where: {
      usuarioId_diagramaId: {
        usuarioId: maria.id,
        diagramaId: diagrama.id,
      },
    },
    update: {},
    create: {
      usuarioId: maria.id,
      diagramaId: diagrama.id,
      rol: RolColaborador.COLABORADOR,
    },
  });

  console.log("Seed completado:");
  console.log(`  Juan:   ${juan.id} (juan@test.com / 123456)`);
  console.log(`  Maria:  ${maria.id} (maria@test.com / 123456)`);
  console.log(`  Diagrama: ${diagrama.id} ("Diagrama de prueba")`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
