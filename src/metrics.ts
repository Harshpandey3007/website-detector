import client from "prom-client";
client.collectDefaultMetrics();

export const jobsProcessed = new client.Counter({
  name: "checks_processed_total",
  help: "Total checks processed",
  labelNames: ["status"],
});

export const changesDetected = new client.Counter({
  name: "changes_detected_total",
  help: "Total changes detected",
});

export const alertsSent = new client.Counter({
  name: "alerts_sent_total",
  help: "Total alerts sent",
});

export const register = client.register;