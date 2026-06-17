import readline from "node:readline"
import process from "node:process"

const [api] = process.argv.slice(2)
const apiBase = api?.replace(/\/?$/, "/")

// BARTOC scheme URI for Basisklassifikation (BK).
const bkUri = "http://bartoc.org/en/node/18785"

// DANTE is also the source bartoc-search uses for BK labels. We resolve it here
// during the batch job so bartoc.org does not need runtime lookups for display.
const bkConceptsUrl = "https://api.dante.gbv.de/data"
const bkConceptBatchSize = 20
const bkConceptFields = ["prefLabel", "notation", "type", "altLabel", "definition", "scopeNote"]
const bkConcepts = new Map()

// Build an API endpoint URL against the configured BARTOC API base.
function endpoint(path, params = {}) {
  const url = new URL(path, apiBase)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url
}

// Fetch JSON and turn network/HTTP failures into messages useful in cron logs.
async function fetchJson(url, options) {
  let response
  try {
    response = await fetch(url, options)
  } catch (e) {
    const reason = e.cause?.message || e.message
    throw new Error(`Fetch failed for ${url}: ${reason}`)
  }
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${response.status} ${response.statusText}`)
  }
  return response.json()
}

// mappings/apply returns lightweight BK subjects with BARTOC-local inScheme and
// MAPPING. DANTE provides display fields such as labels and notation. Copy only
// those display fields, then let the local mapped subject win on overlapping
// fields such as uri, inScheme, and MAPPING.
function materializeBkSubject(subject, concept) {
  if (!concept) {
    return subject
  }

  const displayFields = {}
  for (const field of bkConceptFields) {
    if (concept[field] !== undefined) {
      displayFields[field] = concept[field]
    }
  }
  return { ...displayFields, ...subject }
}

// Treat any non-empty prefLabel object as already usable for display.
function hasPrefLabel(subject) {
  return subject.prefLabel && Object.keys(subject.prefLabel).length
}

// Any subject already in the BK scheme.
function isBkSubject(subject) {
  return subject.inScheme?.some(scheme => scheme.uri === bkUri)
}

// BK subjects created by this job carry the mapping URI that produced them.
// BK subjects without MAPPING are treated as manual data and preserved.
function isGeneratedBkSubject(subject) {
  return isBkSubject(subject) && subject.MAPPING
}

// Resolve missing BK labels from DANTE in batches and cache them for this run.
async function resolveBkConcepts(subjects) {
  const uris = [
    ...new Set(subjects
      .filter(subject => !hasPrefLabel(subject))
      .map(subject => subject.uri)
      .filter(Boolean))
  ]
  const uncachedUris = uris.filter(uri => !bkConcepts.has(uri))

  for (let index = 0; index < uncachedUris.length; index += bkConceptBatchSize) {
    const batch = uncachedUris.slice(index, index + bkConceptBatchSize)
    const url = new URL(bkConceptsUrl)
    url.searchParams.set("uri", batch.join("|"))

    let fetchedConcepts
    try {
      fetchedConcepts = await fetchJson(url)
    } catch (e) {
      console.error(`DANTE lookup failed for BK batch ${batch.join("|")}: ${e}`)
      continue
    }
    if (!Array.isArray(fetchedConcepts)) {
      console.error(`Unexpected DANTE response for BK batch ${batch.join("|")}`)
      continue
    }
    for (const concept of fetchedConcepts) {
      if (concept?.uri) {
        bkConcepts.set(concept.uri, concept)
      }
    }
  }

  return new Map(uris
    .filter(uri => bkConcepts.has(uri))
    .map(uri => [uri, bkConcepts.get(uri)]))
}

// Report how many derived BK subjects are display-ready after enrichment.
function logBkLabelResolution(uri, subjects) {
  const missing = subjects
    .filter(subject => !hasPrefLabel(subject))
    .map(subject => subject.uri)
    .filter(Boolean)
  const resolved = subjects.length - missing.length
  const message = `${uri} BK labels resolved: ${resolved}/${subjects.length}`

  console.error(missing.length ? `${message}; missing: ${missing.join(", ")}` : message)
}

// Refresh generated BK subjects for one BARTOC scheme.
async function processScheme(uri) {
  // Validate URI.
  if (!uri.match(/^http:\/\/bartoc.org\/en\/node\/[0-9]+$/)) {
    console.error(`${uri} skipped: not a BARTOC URI`)
    return
  }

  // Load record.
  const [record] = await fetchJson(endpoint("data", { uri }))
  if (!record) {
    throw new Error(`Terminology not found: ${uri}`)
  }

  // Read subjects.
  const subjects = record.subject || []
  if (!subjects.length) {
    console.error(`${uri} has not subjects`)
    return
  }

  // Split source subjects from subjects to preserve.
  const sourceSubjects = subjects.filter(subject => !isBkSubject(subject))
  const keptSubjects = subjects.filter(subject => !isGeneratedBkSubject(subject))
  const oldGeneratedBkCount = subjects.length - keptSubjects.length

  // Apply current DDC -> BK mappings.
  const enriched = await fetchJson(endpoint("mappings/apply", { toScheme: bkUri }), {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(sourceSubjects)
  })

  const mappedBkSubjects = enriched.slice(sourceSubjects.length)

  // Stop if nothing changed.
  if (!oldGeneratedBkCount && !mappedBkSubjects.length) {
    console.error(`${uri} no BK enrichment found`)
    return
  }

  // Resolve BK labels.
  const concepts = await resolveBkConcepts(mappedBkSubjects)
  const bkSubjects = mappedBkSubjects.map(subject => materializeBkSubject(subject, concepts.get(subject.uri)))

  if (bkSubjects.length) {
    logBkLabelResolution(uri, bkSubjects)
  } else {
    console.error(`${uri} removed ${oldGeneratedBkCount} stale BK subjects`)
  }

  // Emit updated record.
  record.subject = [...keptSubjects, ...bkSubjects]
  console.log(JSON.stringify(record))
}

// Fail early if the configured BARTOC API is not reachable.
try {
    const status = await fetchJson(endpoint("status"))
    if (!status?.ok) {
        throw new Error(`Missing or wrong API: ${api}`)
    }
} catch (e) {
  console.error(`${e}`)
  process.exit(1)
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

// Process records sequentially. This avoids flooding the local API and DANTE
// with many parallel requests when the dump contains many BARTOC records.
for await (const line of rl) {
  try {
    await processScheme(line)
  } catch (e) {
    console.error(`${e}`)
  }
}
