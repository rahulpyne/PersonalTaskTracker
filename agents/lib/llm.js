import { GoogleGenerativeAI } from '@google/generative-ai'

export function createLLMClient(apiKey, model = 'gemini-2.0-flash-lite') {
  const ai = new GoogleGenerativeAI(apiKey)
  return ai.getGenerativeModel({ model })
}

// Call the model and parse the JSON response reliably
export async function jsonPrompt(model, prompt) {
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  })
  const text = result.response.text()
  return JSON.parse(text)
}
