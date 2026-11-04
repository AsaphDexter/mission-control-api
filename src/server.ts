import { buildApp } from "./app.js";

const app = buildApp();

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");

async function start(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    app.log.error({ port }, "PORT must be an integer between 1 and 65535.");
    await app.close();
    process.exitCode = 1;
    return;
  }

  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error({ err: error }, "Mission Control API failed to start.");
    await app.close();
    process.exitCode = 1;
  }
}

await start();
