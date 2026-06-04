import readline from "node:readline"
import process from "node:process"

const [api] = process.argv.slice(2)
const apiBase = api?.replace(/\/?$/, "/")
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

// Merge resolved BK concept data into a mapped subject without losing local fields.
function materializeBkSubject(subject, concept) {
  if (!concept) {
    return subject
  }

  const materialized = {}
  for (const field of bkConceptFields) {
    if (concept[field] !== undefined) {
      materialized[field] = concept[field]
    }
  }
  Object.assign(materialized, subject)

  // Keep the local BARTOC subject shape from mappings/apply. DANTE's concept has
  // its own inScheme URI, while BARTOC needs http://bartoc.org/en/node/18785.
  materialized.uri = subject.uri
  materialized.inScheme = subject.inScheme
  materialized.MAPPING = subject.MAPPING
  return materialized
}

// Treat any non-empty prefLabel object as already usable for display.
function hasPrefLabel(subject) {
  return subject.prefLabel && Object.keys(subject.prefLabel).length
}

// Resolve missing BK labels from DANTE in batches and cache them for this run.
async function resolveBkConcepts(subjects) {
  const uris = [
    ...new Set(subjects
      .filter(subject => !hasPrefLabel(subject))
      .map(subject => subject.uri)
      .filter(Boolean))
  ]
  const concepts = new Map()
  const missing = uris.filter(uri => !bkConcepts.has(uri))

  for (let index = 0; index < missing.length; index += bkConceptBatchSize) {
    const batch = missing.slice(index, index + bkConceptBatchSize)
    const url = new URL(bkConceptsUrl)
    url.searchParams.set("uri", batch.join("|"))

    let records
    try {
      records = await fetchJson(url)
    } catch (e) {
      console.error(`DANTE lookup failed for BK batch ${batch.join("|")}: ${e}`)
      continue
    }
    if (!Array.isArray(records)) {
      console.error(`Unexpected DANTE response for BK batch ${batch.join("|")}`)
      continue
    }
    for (const concept of records) {
      if (concept?.uri) {
        bkConcepts.set(concept.uri, concept)
      }
    }
  }

  for (const uri of uris) {
    if (bkConcepts.has(uri)) {
      concepts.set(uri, bkConcepts.get(uri))
    }
  }

  return concepts
}

// Report how many derived BK subjects are display-ready after enrichment.
function logBkLabelResolution(uri, subjects) {
  const resolved = subjects.filter(hasPrefLabel).length
  const missing = subjects
    .filter(subject => !hasPrefLabel(subject))
    .map(subject => subject.uri)
    .filter(Boolean)

  if (missing.length) {
    console.error(`${uri} BK labels resolved: ${resolved}/${subjects.length}; missing: ${missing.join(", ")}`)
  } else {
    console.error(`${uri} BK labels resolved: ${resolved}/${subjects.length}`)
  }
}

// Process one BARTOC scheme URI from stdin and emit it only when BK was added.
async function processScheme(uri) {
  if (!uri.match(/^http:\/\/bartoc.org\/en\/node\/[0-9]+$/)) {
    throw new Error("Please provide a BARTOC URI")
  }

  const records = await fetchJson(endpoint("data", { uri }))
  if (!records.length) {
    throw new Error(`Terminology not found: ${uri}`)
  }

  const currentSubjects = records[0].subject || []
  if (!currentSubjects.length) {
    console.error(`${uri} has not subjects`)
  } else {
    // remove existing BK
    const subjects = currentSubjects.filter(s => s.inScheme?.[0]?.uri !== bkUri)

    // get enriched subjects
    const enriched = await fetchJson(endpoint("mappings/apply", { toScheme: bkUri }), {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(subjects)
    })

    if (enriched.length > subjects.length) {
      // emit enriched record
      const added = enriched.slice(subjects.length)
      const concepts = await resolveBkConcepts(added)
      const resolved = added.map(subject => materializeBkSubject(subject, concepts.get(subject.uri)))
      logBkLabelResolution(uri, resolved)
      records[0].subject = [...subjects, ...resolved]
      console.log(JSON.stringify(records[0]))
    } else {
      console.error(`${uri} no BK enrichment found`)
    }
  }
}

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

for await (const line of rl) {
  try {
    await processScheme(line)
  } catch (e) {
    console.error(`${e}`)
  }
}
