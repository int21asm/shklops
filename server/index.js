import { createApplication } from "./app.js";
const runtime = await createApplication({
  development: process.env.NODE_ENV === "development",
});
const server = runtime.app.listen(
  Number(process.env.PORT || 3002),
  process.env.HOST || "0.0.0.0",
  () =>
    console.log(`Kaspion Web listening on port ${process.env.PORT || 3002}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      await runtime.close();
      process.exit(0);
    }),
  );
