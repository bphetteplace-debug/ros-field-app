// src/lib/i18n.js — Lightweight translation for tech-facing surfaces.
//
// Two-language MVP (English / Spanish) so Pedro + Vladimir can fill out
// work orders in Spanish. PDF + admin views still read in English: the
// submit flow runs free-form text through Claude Haiku (see api/translate.js
// + src/lib/translate.js) and persists English copies alongside the
// original Spanish on the submission row.
//
// Strategy: keys ARE the English string (`t('Customer')` returns 'Customer'
// in EN, 'Cliente' in ES). Missing translations fall through to the key, so
// a forgotten string just renders English rather than crashing.
//
// Storage: localStorage key 'ros_lang' — sticky per device. Each tech sets
// it once on their phone. No profile/server roundtrip needed.

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'ros_lang'
const DEFAULT_LANG = 'en'
export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇲🇽' },
]

// Spanish dictionary. Keys are the English source string. Coverage focuses
// on FormPage (PM/SC ticket — primary tech surface). NavBar gets translated
// too since it's on every page. Admin pages stay English by design.
const ES = {
  // NavBar
  '+ Work Order': '+ Orden',
  '+ Expense': '+ Gasto',
  '+ Insp': '+ Insp',
  '+ JHA': '+ JHA',
  'Inventory': 'Inventario',
  '+ Quote': '+ Cotización',
  'My Jobs': 'Mis Trabajos',
  'Admin': 'Admin',
  'Logout': 'Cerrar sesión',
  'Logging out...': 'Cerrando sesión...',
  'Language': 'Idioma',

  // FormPage hero / banners
  'Job Ticket': 'Orden de Trabajo',
  'Job Type': 'Tipo de Trabajo',
  'PM': 'Mantenimiento',
  'Service Call': 'Servicio',
  'Repair': 'Reparación',
  'Other': 'Otro',
  'Offline': 'Sin conexión',
  '— will auto-submit when connection returns': '— se enviará automáticamente cuando vuelva la conexión',
  'Draft resumed': 'Borrador recuperado',
  '— picked up where you left off.': '— continuando donde lo dejó.',
  'Dismiss': 'Descartar',
  'Quick start': 'Inicio rápido',
  'Use It': 'Usarlo',

  // Customer / location block
  'Customer': 'Cliente',
  'Truck': 'Camión',
  'Location / Well Name': 'Sitio / Nombre del Pozo',
  'Site / pad / lease': 'Sitio / plataforma / arrendamiento',
  'Customer Work Order / PO #': 'Orden de Cliente / PO #',
  'Contact': 'Contacto',
  'Type of Work': 'Tipo de Trabajo',
  'GL Code': 'Código GL',
  'Asset Tag': 'Etiqueta de Activo',
  'Work Area': 'Área de Trabajo',
  'Warranty Work': 'Trabajo en Garantía',

  // Dates / times
  'Date': 'Fecha',
  'Arrival Time': 'Hora de Llegada',
  'Departure Time': 'Hora de Salida',
  'Last Service Date': 'Última Fecha de Servicio',

  // Description / issue
  'Description': 'Descripción',
  'Description / Work Performed': 'Descripción / Trabajo Realizado',
  'Reported Issue': 'Problema Reportado',
  'Root Cause': 'Causa Raíz',
  'What does the tech need to know before they get on site?': '¿Qué necesita saber el técnico antes de llegar al sitio?',

  // Techs / equipment / permits
  'Field Technicians': 'Técnicos de Campo',
  'Technicians On Site': 'Técnicos en el Sitio',
  'Technician': 'Técnico',
  'Equipment': 'Equipo',
  'Permits Required': 'Permisos Requeridos',
  'Billable Techs': 'Técnicos Facturables',

  // Parts
  'Parts': 'Partes',
  'Add Part': 'Agregar Parte',
  'Part Code': 'Código de Parte',
  'Quantity': 'Cantidad',
  'Price': 'Precio',
  'Search parts...': 'Buscar partes...',

  // Cost summary
  'Cost Summary': 'Resumen de Costo',
  'Miles Driven': 'Millas Recorridas',
  'Rate ($/mile)': 'Tarifa ($/milla)',
  'Labor Hours': 'Horas de Mano de Obra',
  'Rate ($/hour)': 'Tarifa ($/hora)',
  'Parts Total': 'Total de Partes',
  'Mileage Total': 'Total de Millaje',
  'Labor Total': 'Total de Mano de Obra',
  'Grand Total': 'Total General',

  // Photos
  'Photos': 'Fotos',
  'Take Photo': 'Tomar Foto',
  'From Gallery': 'De la Galería',
  'Site Sign Photo': 'Foto del Letrero del Sitio',
  'Camera': 'Cámara',
  'Gallery': 'Galería',
  'added': 'agregadas',
  'Arrival Video': 'Video de Llegada',
  'Departure Video': 'Video de Salida',

  // Signatures
  'Customer Sign-Off': 'Firma del Cliente',
  'Customer Signature': 'Firma del Cliente',
  'Customer signature confirms satisfactory completion of the work described above.':
    'La firma del cliente confirma la finalización satisfactoria del trabajo descrito arriba.',
  'Required': 'Requerido',
  '✓ Signed': '✓ Firmado',
  'Save': 'Guardar',
  'Clear': 'Limpiar',

  // PM equipment sections
  'Flame Arrestors': 'Arrestadores de Llama',
  'Flares': 'Antorchas',
  'Heaters': 'Calentadores',
  'Firetubes': 'Tubos de Fuego',
  'Condition': 'Condición',
  'Good': 'Bueno',
  'Fair': 'Regular',
  'Poor': 'Malo',
  'Notes': 'Notas',
  'Filter Changed': 'Filtro Cambiado',
  'Pilot Lit': 'Piloto Encendido',
  'Last Ignition': 'Última Ignición',
  'Last Clean Date': 'Última Fecha de Limpieza',
  'Arrestor ID': 'ID del Arrestador',
  'Flare ID': 'ID de la Antorcha',
  'Heater ID': 'ID del Calentador',
  'Before': 'Antes',
  'After': 'Después',

  // Submit / review
  'Submit': 'Enviar',
  'Review': 'Revisar',
  'Save Draft': 'Guardar Borrador',
  'Submitting...': 'Enviando...',
  'Saving...': 'Guardando...',
  'Preparing photos…': 'Preparando fotos…',
  'Saving submission…': 'Guardando envío…',
  'Generating PDF…': 'Generando PDF…',
  'Sending email…': 'Enviando correo…',
  'Submission failed. Please try again.': 'Falló el envío. Por favor intente de nuevo.',
  'Missing required field': 'Falta campo requerido',
  'Missing required fields': 'Faltan campos requeridos',

  // Misc UI
  'Yes': 'Sí',
  'No': 'No',
  'Cancel': 'Cancelar',
  'Delete': 'Eliminar',
  'Edit': 'Editar',
  'Add': 'Agregar',
  'Remove': 'Quitar',
  'Loading...': 'Cargando...',
  'Refresh': 'Actualizar',

  // Live job clock
  'Elapsed': 'Tiempo Transcurrido',
  'Auto-filled': 'Llenado automáticamente',
  'On the clock': 'En servicio',
  'Job clock': 'Reloj del Trabajo',
  'since': 'desde',
  'Labor Hours manually set to': 'Horas de mano de obra establecidas manualmente a',
  '⚡ Auto-tracking · Labor Hours': '⚡ Seguimiento automático · Horas de mano de obra',

  // FormPage section titles + headers
  'Job Information': 'Información del Trabajo',
  'Permit Requirements': 'Requisitos de Permisos',
  'Technicians': 'Técnicos',
  'Date & Time': 'Fecha y Hora',
  'Work Description': 'Descripción del Trabajo',
  'Equipment Worked On': 'Equipo Trabajado',
  'Heater Treaters': 'Tratadores de Calor',
  'Work Performed': 'Trabajo Realizado',
  'Selected ✓': 'Seleccionado ✓',
  'Smart copy': 'Copia inteligente',
  'Copy details from your last visit here': 'Copiar detalles de su última visita aquí',
  'Copy': 'Copiar',

  // GPS
  '⏳ Getting GPS…': '⏳ Obteniendo GPS…',
  '✅ GPS Captured': '✅ GPS Capturado',
  '📍 Capture GPS': '📍 Capturar GPS',
  '🗺️ View Map ↗': '🗺️ Ver Mapa ↗',

  // Placeholders
  'e.g. Pad A — Well 12': 'ej. Plataforma A — Pozo 12',
  'Name / phone': 'Nombre / teléfono',
  "Required — enter the customer's WO/PO #": 'Requerido — ingrese la WO/PO # del cliente',
  'Scan or type': 'Escanear o escribir',
  'Scan nameplate, dictate, or type': 'Escanear placa, dictar o escribir',
  'What was the customer-reported problem?': '¿Cuál fue el problema reportado por el cliente?',
  'Identified root cause...': 'Causa raíz identificada...',
  'Describe all work performed...': 'Describa todo el trabajo realizado...',
  'Notes…': 'Notas…',
  'Equipment / Serial Numbers': 'Equipo / Números de Serie',
  'ARR-001 or scan': 'ARR-001 o escanear',
  'FLR-001 or scan': 'FLR-001 o escanear',
  'HT-001 or scan': 'HT-001 o escanear',

  // Warranty
  '⚠️ Warranty Work — No Charge': '⚠️ Trabajo en Garantía — Sin Cargo',
  'Warranty Work (no charge to customer)': 'Trabajo en Garantía (sin cargo al cliente)',

  // Tech section
  'Billable Techs:': 'Técnicos Facturables:',
  '(default:': '(predeterminado:',
  'selected)': 'seleccionados)',

  // Permits + equipment
  'Tap permits required for this job:': 'Toque los permisos requeridos para este trabajo:',
  '⚠️ Active:': '⚠️ Activos:',
  'Select all equipment types worked on this call:': 'Seleccione todos los tipos de equipo trabajados en esta llamada:',
  'Notes for': 'Notas para',
  'No equipment selected yet': 'Aún no se ha seleccionado equipo',

  // Arrestor / flare / heater
  'Arrestor #': 'Arrestador #',
  'Flare #': 'Antorcha #',
  'Heater Treater #': 'Tratador de Calor #',
  'Firetube #': 'Tubo de Fuego #',
  'ID / Tag #': 'ID / Etiqueta #',
  'Flare ID / Tag #': 'ID / Etiqueta de Antorcha #',
  'Filter / Element Changed': 'Filtro / Elemento Cambiado',
  'Pilot Lit on Departure': 'Piloto Encendido al Salir',
  'Photo 1': 'Foto 1',
  'Photo 2': 'Foto 2',
  'Before — Photo 1': 'Antes — Foto 1',
  'Before — Photo 2': 'Antes — Foto 2',
  'After — Photo 1': 'Después — Foto 1',
  'After — Photo 2': 'Después — Foto 2',
  '+ Add Arrestor': '+ Agregar Arrestador',
  '+ Add Flare': '+ Agregar Antorcha',
  '+ Add Heater Treater': '+ Agregar Tratador de Calor',
  '+ Add Firetube': '+ Agregar Tubo de Fuego',

  // Parts catalog + cost summary
  'Add Custom Part': 'Agregar Parte Personalizada',
  'Search catalog': 'Buscar catálogo',
  'No parts added': 'No se han agregado partes',
  'Qty': 'Cant',
  'Total': 'Total',
  'Subtotal': 'Subtotal',

  // Photo gallery
  'Work Photos': 'Fotos del Trabajo',
  '+ Camera': '+ Cámara',
  '+ Gallery': '+ Galería',
  'photos added': 'fotos agregadas',
  'No photos added': 'No se han agregado fotos',

  // Submit / footer
  'Review Submission': 'Revisar Envío',
  'Saving — please wait…': 'Guardando — por favor espere…',
  'Tap to review and submit': 'Toque para revisar y enviar',
  'Submission saved': 'Envío guardado',
  'Retry photo upload': 'Reintentar carga de fotos',

  // Misc
  'Use last': 'Usar último',
  'as template': 'como plantilla',
  'previous job': 'trabajo anterior',

  // Heater section + parts + videos + photos + cost summary + submit
  'Last Tube Clean Date': 'Última Fecha de Limpieza de Tubos',
  'Firetubes': 'Tubos de Fuego',
  'Parts Used': 'Partes Usadas',
  '▲ Close Catalog': '▲ Cerrar Catálogo',
  '🔍 Add Part from Catalog': '🔍 Agregar Parte del Catálogo',
  'Search by name or SKU…': 'Buscar por nombre o SKU…',
  'No parts found': 'No se encontraron partes',
  'Arrival & Departure Videos': 'Videos de Llegada y Salida',
  'Record a short video on arrival and after completing the work.': 'Grabe un video corto al llegar y después de completar el trabajo.',
  '✕ Remove': '✕ Quitar',
  'Record Arrival': 'Grabar Llegada',
  'Record Departure': 'Grabar Salida',
  '🖼️ Or upload from gallery': '🖼️ O subir desde galería',
  'Job Photos': 'Fotos del Trabajo',
  '◂ ▸ arrows to reorder · ⋮⋮ to drag · tap photo to enlarge · × to remove': '◂ ▸ flechas para reordenar · ⋮⋮ para arrastrar · toque la foto para ampliar · × para quitar',
  '⚠️ WARRANTY — NO CHARGE': '⚠️ GARANTÍA — SIN CARGO',
  '🔩 Parts': '🔩 Partes',
  '🚗 Mileage': '🚗 Millaje',
  '⏱️ Labor': '⏱️ Mano de Obra',
  'item': 'artículo',
  'items': 'artículos',
  'tech': 'técnico',
  'techs': 'técnicos',
  'hrs ×': 'hrs ×',
  '✅ Saved': '✅ Guardado',
  '💾 Save Draft': '💾 Guardar Borrador',
  'Retrying…': 'Reintentando…',
  '🔄 Retry': '🔄 Reintentar',
  'Saving…': 'Guardando…',
  'Review & Send': 'Revisar y Enviar',
}

const DICT = { en: {}, es: ES }

// Read once at module load — synchronous so the first render has the right lang.
function readStoredLang() {
  if (typeof localStorage === 'undefined') return DEFAULT_LANG
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return (v === 'es' || v === 'en') ? v : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG
  }
}

// In-module listener registry so every useLang() hook re-renders when
// setLang() fires anywhere in the app.
const listeners = new Set()
let currentLang = readStoredLang()

export function getLang() {
  return currentLang
}

export function setLang(next) {
  if (next !== 'en' && next !== 'es') return
  if (next === currentLang) return
  currentLang = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  listeners.forEach(fn => { try { fn(next) } catch {} })
}

// React hook — returns [lang, setLang] and re-renders the calling component
// whenever any other component flips the language.
export function useLang() {
  const [lang, setLocal] = useState(currentLang)
  useEffect(() => {
    const onChange = (l) => setLocal(l)
    listeners.add(onChange)
    return () => { listeners.delete(onChange) }
  }, [])
  return [lang, setLang]
}

// Translate a key. Falls back to the key itself if no translation exists
// for the requested language (so a forgotten string renders English, not
// a blank or "undefined").
export function t(key, lang) {
  const l = lang || currentLang
  if (l === 'en') return key
  const table = DICT[l]
  if (!table) return key
  const hit = table[key]
  return (typeof hit === 'string') ? hit : key
}

// Convenience: returns just the t() function bound to current lang. Useful
// for components that don't otherwise need the lang value.
export function useT() {
  const [lang] = useLang()
  return (key) => t(key, lang)
}

// For places that need to know the speech-recognition locale (MicButton)
// or any other language-derived setting.
export function speechLocale(lang) {
  const l = lang || currentLang
  return l === 'es' ? 'es-MX' : 'en-US'
}
