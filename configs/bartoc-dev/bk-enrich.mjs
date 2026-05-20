import readline from "node:readline"

const [api] = process.argv.slice(2)
const apiBase = api?.replace(/\/?$/, "/")
const bkUri = "http://bartoc.org/en/node/18785"

// DANTE is also the source bartoc-search uses for BK labels. We resolve it here
// during the batch job so bartoc.org does not need runtime lookups for display.
const bkConceptsUrl = "https://api.dante.gbv.de/data"
const bkConceptBatchSize = 20
const bkConceptFields = ["prefLabel", "notation", "type", "altLabel", "definition", "scopeNote"]

function endpoint(path, params = {}) {
  const url = new URL(path, apiBase)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url
}

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

function materializeBkSubject(subject, concept) {
  if (!concept) {
    return subject
  }

  const materialized = { ...subject }
  for (const field of bkConceptFields) {
    if (concept[field] !== undefined) {
      materialized[field] = concept[field]
    }
  }

  // Keep the local BARTOC subject shape from mappings/apply. DANTE's concept has
  // its own inScheme URI, while BARTOC needs http://bartoc.org/en/node/18785.
  materialized.uri = subject.uri
  materialized.inScheme = subject.inScheme
  materialized.MAPPING = subject.MAPPING
  return materialized
}

async function resolveBkConcepts(subjects) {
  const uris = [...new Set(subjects.map(subject => subject.uri).filter(Boolean))]
  const concepts = new Map()

  for (let index = 0; index < uris.length; index += bkConceptBatchSize) {
    const batch = uris.slice(index, index + bkConceptBatchSize)
    const url = new URL(bkConceptsUrl)
    url.searchParams.set("uri", batch.join("|"))

    let records
    try {
      records = await fetchJson(url)
    } catch (e) {
      console.error(`${e}`)
      continue
    }
    if (!Array.isArray(records)) {
      console.error(`Unexpected DANTE response for ${url}`)
      continue
    }
    for (const concept of records) {
      if (concept?.uri) {
        concepts.set(concept.uri, concept)
      }
    }
  }

  for (const uri of uris) {
    if (!concepts.has(uri)) {
      console.error(`BK concept not found in DANTE: ${uri}`)
    }
  }

  return concepts
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

readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
}).on('line', async line => { try { await processScheme(line) } catch (e) { console.error(`${e}`) } })

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
      records[0].subject = [...subjects, ...resolved]
      console.log(JSON.stringify(records[0]))
    } else {
      console.error(`${uri} no BK enrichment found`)
    }
  }
}
