const axios = require("axios");
const API = "http://localhost:3000";
const KEY = "secret-demo-key-2026-super-secure";
const h = { headers: { "x-api-key": "secret-demo-key" } };

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`✅ ${name}`); passed++; }
  catch (e) { console.log(`❌ ${name} — ${e.message}`); failed++; }
};

(async () => {
  console.log("🧪 Testing...\n");

  await test("Health endpoint", async () => {
    const r = await axios.get(`${API}/health`);
    if (!r.data.ok) throw new Error("not ok");
  });

  await test("Auth blocks without key", async () => {
    try { await axios.get(`${API}/monitors`); throw new Error("should block"); }
    catch (e) { if (e.response?.status !== 401) throw new Error("expected 401"); }
  });

  await test("SSRF blocks localhost", async () => {
    try {
      await axios.post(`${API}/monitors`, { url: "http://localhost:9999", name: "b", intervalMins: 15 }, h);
      throw new Error("should block");
    } catch (e) { if (e.response?.status !== 400) throw new Error("expected 400"); }
  });

  let id;
  await test("Create monitor", async () => {
    const r = await axios.post(`${API}/monitors`, {
      url: "https://example.com", name: "Example", intervalMins: 15, sensitivity: 1
    }, h);
    id = r.data.id;
    if (!id) throw new Error("no id");
  });

  await test("List monitors", async () => {
    const r = await axios.get(`${API}/monitors`, h);
    if (!Array.isArray(r.data)) throw new Error("not array");
  });

  await test("History endpoint", async () => {
    const r = await axios.get(`${API}/monitors/${id}/history`, h);
    if (!Array.isArray(r.data)) throw new Error("not array");
  });

  await test("Manual check", async () => {
    const r = await axios.post(`${API}/monitors/${id}/check`, {}, h);
    if (!r.data.queued) throw new Error("not queued");
  });

  await test("Delete monitor", async () => {
    const r = await axios.delete(`${API}/monitors/${id}`, h);
    if (!r.data.ok) throw new Error("delete failed");
  });

  console.log(`\n📊 ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();