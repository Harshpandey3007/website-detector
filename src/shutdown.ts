import { worker } from "./worker";
import { checkQueue, queueEvents, connection } from "./queue";
import { prisma } from "./db";

let closing = false;

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 25_000); // Render allows ~30s after SIGTERM
  force.unref();
  try {
    await worker.close(); // lets the job that is running finish
    await queueEvents.close();
    await checkQueue.close();
    await connection.quit();
    await prisma.$disconnect();
  } catch (err) {
    console.error("Shutdown error:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// Safety net only: express-async-errors is what keeps request handlers from reaching this.
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));
