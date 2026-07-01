// Sincroniza resultados desde football-data.org hacia Mongo. Ejecutar: npm run sync
import { syncFromProvider } from "../src/lib/sync";

syncFromProvider()
  .then((r) => {
    console.log(r.message);
    process.exit(r.ok ? 0 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
