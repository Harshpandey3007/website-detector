import { GoogleGenerativeAI } from "@google/generative-ai";

export async function summarizeChange(oldText: string, newText: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Summarize the meaningful differences between these two webpage versions in ONE sentence (max 25 words). If only noise, say "No meaningful change."\n\nOLD:\n${oldText.slice(0, 3000)}\n\nNEW:\n${newText.slice(0, 3000)}\n\nSummary:`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    console.error("Gemini error:", e);
    return null;
  }
}