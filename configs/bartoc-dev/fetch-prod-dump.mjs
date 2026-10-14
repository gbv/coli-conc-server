// File operations use promises so each step finishes before the next one starts.
import { writeFile, rename, rm } from "node:fs/promises"

// BARTOC publishes one vocabulary per line at this URL.
const url = "https://bartoc.org/data/dumps/latest.ndjson"
// The import job reads this file after the download succeeds.
const destination = "/tmp/bartoc-prod-vocabularies.ndjson"
// A separate file prevents the import job from seeing a partial download.
const temporary = `${destination}.${process.pid}.tmp`

// A failed run must not leave yesterday's staged dump available for import.
await rm(destination, { force: true })

// Download the public dump and stop on network or HTTP errors.
const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
if (!response.ok) throw new Error(`Dump download failed: HTTP ${response.status}`)

// Each record needs a URI; the final newline also lets the import job count records.
const data = await response.text()
if (!data.endsWith("\n")) throw new Error("Production dump has no final newline")

// Split the text into records and remember URIs to catch duplicates.
const lines = data.trimEnd().split(/\r?\n/)
const uris = new Set()
for (const [index, line] of lines.entries()) {
  // Invalid JSON stops the job before any database import begins.
  const vocabulary = JSON.parse(line)
  // Every record must identify one distinct vocabulary.
  if (typeof vocabulary?.uri !== "string" || !vocabulary.uri.trim() || uris.has(vocabulary.uri)) {
    throw new Error(`Missing or duplicate URI on line ${index + 1}`)
  }
  uris.add(vocabulary.uri)
}

// Rename only after the download and all checks succeed, so no partial file is used.
try {
  // Restrict access to the staged file inside the container.
  await writeFile(temporary, data, { mode: 0o600 })
  await rename(temporary, destination)
} finally {
  // Remove a leftover temporary file if writing or renaming fails.
  await rm(temporary, { force: true })
}

// This count is useful when checking the cron log.
console.log(`Prepared ${lines.length} vocabularies from production`)
