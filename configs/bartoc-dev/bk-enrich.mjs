import readline from "node:readline"

const [api] = process.argv.slice(2)

try {
    const status = await fetch(`${api}/status`).then(res => res.json())
    if (!status?.ok) {
        throw new Error(`Missing or wrong API: ${api}`)
    }
} catch (e) {
  console.error(`${e}`)
  process.exit(1)
}

const bkUri = "http://bartoc.org/de/node/241"

readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
}).on('line', async line => { try { await processScheme(line) } catch (e) { console.error(`${e}`) } })

async function processScheme(uri) {
  if (!uri.match(/^http:\/\/bartoc.org\/en\/node\/[0-9]+$/)) {
    throw new Error("Please provide a BARTOC URI")
  }

  const records = await fetch(`${api}/data?uri=${uri}`).then(res => res.json())
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
    const enriched = await fetch(`${api}/mappings/apply?toScheme=${bkUri}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(subjects)
    }).then(res => res.json())

    if (enriched.length > subjects.length) {
      // emit enriched record
      const added = enriched.slice(subjects.length)
      records[0].subject = [...subjects, ...added]
      console.log(JSON.stringify(records[0]))
    } else {
      console.error(`${uri} no BK enrichment found`)
    }
  }
}
