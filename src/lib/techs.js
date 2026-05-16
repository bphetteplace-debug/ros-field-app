// Canonical tech names. The imported workbooks + the techs themselves
// have been inconsistent — "Matt", "matt", "Matthew Reid" are all the
// same person, same for Vlad/Vladimir/Vladimir Rivero and Brian variants.
// Apply canonicalTech() on EVERY tech display surface (Tech Performance,
// Analytics, Customers, Billing) so rollups don't accidentally split
// one person into multiple buckets.

const ALIASES = {
  // Matthew Reid
  matt: 'Matthew Reid',
  Matt: 'Matthew Reid',
  matthew: 'Matthew Reid',
  Matthew: 'Matthew Reid',
  'Matthew Reid': 'Matthew Reid',

  // Vladimir Rivero
  vlad: 'Vladimir Rivero',
  Vlad: 'Vladimir Rivero',
  vladimir: 'Vladimir Rivero',
  Vladimir: 'Vladimir Rivero',
  'Vladimir Rivero': 'Vladimir Rivero',

  // Brian Phetteplace
  brian: 'Brian Phetteplace',
  Brian: 'Brian Phetteplace',
  'Brian Phetteplace': 'Brian Phetteplace',

  // Pedro (full last name TBD — owner can update mapping later)
  pedro: 'Pedro',
  Pedro: 'Pedro',
}

export function canonicalTech(name) {
  if (name == null) return ''
  const trimmed = String(name).trim()
  if (!trimmed) return ''
  return ALIASES[trimmed] || trimmed
}

// For a submission row, return the canonical tech display name. Handles
// the multiple shapes we see in the wild:
//   data.techs[0] (canonical place — what new submissions populate)
//   profiles.full_name (joined from created_by — fallback)
export function techDisplayName(s) {
  const raw = (Array.isArray(s?.data?.techs) && s.data.techs[0]) || s?.profiles?.full_name || ''
  return canonicalTech(raw) || 'Unknown'
}
