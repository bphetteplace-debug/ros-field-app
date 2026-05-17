// scripts/test_translate_quality.mjs — local quality test for the ES→EN
// translation prompt used by api/translate.js. Reads ANTHROPIC_API_KEY
// from .env.local and runs a batch of realistic oilfield Spanish samples
// through Claude Haiku, prints English output side-by-side for review.
//
// Usage:  node scripts/test_translate_quality.mjs
//
// Iterate by editing SYSTEM_PROMPT or adding samples to SAMPLES, then
// re-running. Once happy, sync the prompt back to api/translate.js.

import fs from 'node:fs'
import path from 'node:path'

// Pull ANTHROPIC_API_KEY out of .env.local
const envPath = path.resolve('.env.local')
if (!fs.existsSync(envPath)) {
  console.error('❌ .env.local not found at', envPath)
  process.exit(1)
}
const envText = fs.readFileSync(envPath, 'utf8')
const keyMatch = envText.match(/^ANTHROPIC_API_KEY\s*=\s*([^\s#]+)/m)
if (!keyMatch) {
  console.error('❌ ANTHROPIC_API_KEY not found in .env.local')
  process.exit(1)
}
const ANTHROPIC_KEY = keyMatch[1].trim()
const MODEL = 'claude-haiku-4-5-20251001'

// Keep this in sync with api/translate.js — copy any iterations back.
const SYSTEM_PROMPT = `You translate field-service text written by oilfield technicians from Spanish into natural professional English suitable for a customer-facing PDF work order.

Rules:
- Return ONLY the translation. No preamble, no quotes, no markdown, no commentary.
- Preserve technical terms accurately (heater treater = "heater treater", flare = "flare", flame arrestor = "flame arrestor", firetube = "firetube", separator, manifold, valve, gasket, regulator, pilot, burner, etc.).
- Keep numbers, part codes, asset IDs, GPS coords, and timestamps exactly as written.
- If the input is already English, return it unchanged.
- If the input is empty or just whitespace, return an empty string.
- Preserve urgency: keep exclamation marks on warnings (¡Cuidado! → "Caution!", not "Caution.").
- Prefer natural English phrasing over a literal word-for-word translation. ("La chamba quedó bien" → "The job turned out well", NOT "The job came out good". "El controlador se reinició solo" → "The controller reset on its own", NOT "reset by itself".)
- Use professional but plain register suitable for a work-order PDF the customer will read. Avoid slang in the output even if the input is slangy.
- Grammar and punctuation must be correct in the English output. Complete sentences end with a period.`

// Realistic samples covering edge cases.
const SAMPLES = {
  short_technical:
    'Cambié el filtro del separador, fuga pequeña en la válvula de descarga.',

  long_root_cause:
    'El piloto del calentador 2 estaba apagado porque la línea de gas tenía agua. Drené la línea, encendí el piloto y verifiqué que la presión estuviera correcta en 8 onzas. Se mantuvo encendido 45 minutos antes de salir.',

  with_numbers_and_ids:
    'Arrestador #A-3471 con malla rota y hollín pesado. Reemplazado con parte nuevo P/N 8821-A. Revisar de nuevo en 30 días.',

  caps_urgency:
    'URGENTE: válvula de seguridad del separador no cierra completamente, fuga continua de gas. Se necesita reemplazo antes del próximo turno.',

  mixed_brands_english:
    'Instalé regulador nuevo marca Fisher modelo 627, calibrado a 12 oz. El controlador Murphy se reinició solo después de la prueba.',

  question_phrasing:
    '¿Cliente quiere que regresemos el lunes para la inspección de la antorcha? Pendiente confirmación.',

  english_passthrough:
    'Replaced firetube on heater #5, no visible damage on the new unit.',

  empty_string: '',

  mexican_regional:
    'La chamba quedó bien, nomás falta que el cliente revise. Le pusimos copal en las roscas pa que sellaran mejor.',

  punctuation_heavy:
    '¡Cuidado! Hay aceite en el piso cerca del manifold. Ya limpiamos, pero avisé al supervisor; mañana ponen letrero.',

  parts_list_inline:
    'Partes usadas: 2 empaques de 1/2", 1 válvula de 1/4", 3 abrazaderas, sellador para roscas. Total aproximado $145.',
}

async function translateBatch(fields) {
  const userPrompt = `Translate each field value below from Spanish to English. Reply with ONLY a valid JSON object with the same keys and the translated values — no markdown fences, no preamble.

Input:
${JSON.stringify(fields, null, 2)}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Anthropic HTTP ${res.status}: ${t.slice(0, 400)}`)
  }
  const body = await res.json()
  const text = (body.content && body.content[0] && body.content[0].text) || ''
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not extract JSON from model output:\n' + text)
  return { translations: JSON.parse(match[0]), usage: body.usage }
}

console.log('🌎  Translation quality test — model:', MODEL)
console.log('━'.repeat(80))

const start = Date.now()
let result
try {
  // Filter out empty_string for the actual call (lambda would skip it).
  const inputs = Object.fromEntries(
    Object.entries(SAMPLES).filter(([, v]) => v && v.trim())
  )
  result = await translateBatch(inputs)
} catch (e) {
  console.error('❌ Translation call failed:', e.message)
  process.exit(1)
}
const elapsed = Date.now() - start

for (const [key, esText] of Object.entries(SAMPLES)) {
  console.log()
  console.log(`◆ ${key}`)
  console.log(`  ES: ${esText || '(empty)'}`)
  const en = result.translations[key]
  if (esText && esText.trim()) {
    console.log(`  EN: ${en || '(missing in response!)'}`)
  } else {
    console.log(`  EN: (skipped — empty input handled by lambda before call)`)
  }
}

console.log()
console.log('━'.repeat(80))
console.log(`⏱  ${elapsed} ms  ·  tokens in: ${result.usage?.input_tokens ?? '?'}  ·  out: ${result.usage?.output_tokens ?? '?'}`)
if (result.usage?.cache_read_input_tokens) {
  console.log(`   cache hit: ${result.usage.cache_read_input_tokens} read tokens`)
}
const inT = result.usage?.input_tokens || 0
const outT = result.usage?.output_tokens || 0
// Haiku 4.5 pricing: $1/M input, $5/M output
const cost = (inT * 1 + outT * 5) / 1_000_000
console.log(`💵 Approx cost: $${cost.toFixed(5)}`)
