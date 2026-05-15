import { GoogleGenerativeAI } from '@google/generative-ai'

export function createLLMClient(apiKey, model = 'gemini-2.0-flash-lite') {
  const ai = new GoogleGenerativeAI(apiKey)
  return ai.getGenerativeModel({ model })
}

// Call the model and parse the JSON response reliably.
// Retries up to 3 times with exponential backoff on rate-limit (429) errors.
export async function jsonPrompt(model, prompt, { retries = 3, backoffMs = 5000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      })
      return JSON.parse(result.response.text())
    } catch (e) {
      const is429    = e.message?.includes('429') || e.message?.includes('quota')
      const retryMs  = (() => {
        const m = e.message?.match(/retry in (\d+)/)
        return m ? Number(m[1]) * 1000 : backoffMs * attempt
      })()
      if (is429 && attempt < retries) {
        console.warn(`[LLM] rate-limited, waiting ${Math.round(retryMs / 1000)}s before retry ${attempt + 1}/${retries}`)
        await new Promise(r => setTimeout(r, retryMs))
        continue
      }
      throw e
    }
  }
}
