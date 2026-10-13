/** Deploy BARTOC Search together with the Solr configset in its image. */

import { $ } from "npm:zx@8"
import { getEnv } from "./utils.js"

const { dataPath } = getEnv("")
const imageConfig = "/usr/src/app/docker/solr-config/terminologies-configset/conf"

/** Retry a health check for up to 30 seconds. */
async function waitFor(name, check) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = await check()
    if (result.exitCode === 0) return
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`${name} did not become ready within 30 seconds`)
}

/** Wait until the Solr core responds to a ping. */
async function waitForSolr(solrService) {
  await waitFor("Solr", () => $({ nothrow: true })`docker exec ${solrService} curl -fsS http://localhost:8983/solr/terminologies/admin/ping`)
}

/** Wait until the app can reach Solr and sees indexed records. */
async function waitForBartocSearch(appService) {
  const check = `
    const response = await fetch("http://127.0.0.1:3883/api/status")
    const status = await response.json()
    if (!response.ok || !status.solr?.connected || status.solr.indexedRecords < 1) process.exit(1)
  `
  await waitFor("BARTOC Search", () => $({ nothrow: true })`docker compose exec -T ${appService} node --input-type=module -e ${check}`)
}

/** Copy all Solr data without overwriting an existing destination. */
async function copySolrData(source, destination) {
  const script = `test -d "$1" && test ! -e "$2" && cp -a "$1" "$2"`
  await $({ stdio: "inherit" })`docker run --rm --user 0 -v ${dataPath}:/host-data solr:8 sh -c ${script} -- ${`/host-data/${source}`} ${`/host-data/${destination}`}`
}

/** Create the data folder on a first installation. */
async function ensureSolrData(solrData) {
  await $({ stdio: "inherit" })`docker run --rm --user 0 -v ${dataPath}:/host-data solr:8 mkdir -p ${`/host-data/${solrData}`}`
}

/** Check the pulled image before stopping either service. */
async function checkSolrConfig(image) {
  const script = `test -f ${imageConfig}/schema.xml && test -f ${imageConfig}/solrconfig.xml`
  await $({ stdio: "inherit" })`docker run --rm --entrypoint sh ${image} -c ${script}`
}

/** Install the configset and create the core on a first installation. */
async function installSolrConfig(image, solrData) {
  const script = `
    core="$1/data/terminologies"
    mkdir -p "$core/conf"
    cp -a ${imageConfig}/. "$core/conf/"
    # Solr discovers a new core through this file.
    test -f "$core/core.properties" || touch "$core/core.properties"
    # Docker runs Solr as UID 8983, including on a new data volume.
    chown 8983:8983 "$1" "$1/data" "$core" "$core/core.properties"
    chown -R 8983:8983 "$core/conf"
  `
  await $({ stdio: "inherit" })`docker run --rm --user 0 --entrypoint sh -v ${dataPath}:/host-data ${image} -c ${script} -- ${`/host-data/${solrData}`}`
}

/** Keep failed Solr data for inspection during rollback. */
async function moveSolrData(source, destination) {
  await $({ stdio: "inherit" })`docker run --rm --user 0 -v ${dataPath}:/host-data solr:8 mv ${`/host-data/${source}`} ${`/host-data/${destination}`}`
}

/** Distinguish an existing core from a first installation. */
async function hasSolrCore(solrData) {
  try {
    await Deno.stat(`${dataPath}/${solrData}/data/terminologies/core.properties`)
    return true
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

/** Deploy the app and its Solr schema as one recoverable operation. */
export async function deployBartocSearch({ appService, solrService, image, solrData }) {
  const id = new Date().toISOString().replace(/[^0-9]/g, "")
  const backup = `${appService}-solr-backup-${id}`
  const failed = `${appService}-solr-failed-${id}`
  const previousContainer = await $({ nothrow: true })`docker inspect --format={{.Image}} ${appService}`.quiet()
  const previousImage = previousContainer.exitCode === 0 ? `${previousContainer}`.trim() : null
  const previousSolr = await $({ nothrow: true })`docker inspect --format={{.State.Running}} ${solrService}`.quiet()
  const solrWasRunning = previousSolr.exitCode === 0 && `${previousSolr}`.trim() === "true"
  let solrChanged = false
  let hadCore = false

  console.log(`Deploying ${appService}; Solr backup: ${dataPath}/${backup}`)
  // Check the image before any downtime.
  await $({ stdio: "inherit" })`docker compose pull`
  let candidateImage
  try {
    candidateImage = `${await $`docker image inspect --format={{.Id}} ${image}`.quiet()}`.trim()
    await checkSolrConfig(candidateImage)
  } catch (error) {
    // Pull changes the local image tag even though the running container is unchanged.
    if (previousImage) {
      await $({ stdio: "inherit" })`docker image tag ${previousImage} ${image}`
    }
    throw error
  }
  console.log(`Using Solr config from image ${candidateImage}`)

  try {
    await $({ stdio: "inherit" })`srv stop ${appService}`
    await $({ stdio: "inherit" })`srv stop ${solrService}`

    // 1. Backup: save the schema and index together while Solr is stopped.
    hadCore = await hasSolrCore(solrData)
    await ensureSolrData(solrData)
    await copySolrData(solrData, backup)

    // 2. Installation: update the core, or create it on a first deployment.
    solrChanged = true
    await installSolrConfig(candidateImage, solrData)

    // 3. Verification: start Solr, reindex, then check both services.
    await $({ stdio: "inherit" })`srv start ${solrService}`
    await waitForSolr(solrService)

    const clearIndex = JSON.stringify({ delete: { query: "*:*" } })
    // reindex adds current records but does not remove deleted ones.
    await $({ stdio: "inherit" })`docker exec ${solrService} curl -fsS -H Content-Type:application/json --data-binary ${clearIndex} http://localhost:8983/solr/terminologies/update?commit=true`
    await $({ stdio: "inherit" })`docker compose run --rm -T ${appService} npm run reindex`

    await $({ stdio: "inherit" })`docker compose up -d --remove-orphans`
    await waitForBartocSearch(appService)
    console.log(`Deployed ${appService}. Backup kept at ${dataPath}/${backup}`)
  } catch (error) {
    // 4. Rollback: restore the old image and the complete Solr data snapshot.
    console.error(`Update failed; restoring ${appService} and ${solrService}...`)
    try {
      await $({ nothrow: true, stdio: "inherit" })`srv stop ${appService}`
      await $({ nothrow: true, stdio: "inherit" })`srv stop ${solrService}`
      if (solrChanged) {
        await moveSolrData(solrData, failed)
        await copySolrData(backup, solrData)
      }
      if (previousImage || solrWasRunning) {
        await $({ stdio: "inherit" })`srv start ${solrService}`
        if (hadCore) await waitForSolr(solrService)
      }
      if (previousImage) {
        // Compose resolves the mutable image tag when recreating the app.
        await $({ stdio: "inherit" })`docker image tag ${previousImage} ${image}`
        await $({ stdio: "inherit" })`docker compose up -d --force-recreate --remove-orphans`
        if (hadCore) await waitForBartocSearch(appService)
      } else {
        await $({ nothrow: true, stdio: "inherit" })`docker compose rm -sf ${appService}`
      }
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "BARTOC Search update and rollback failed")
    }
    throw error
  }
}
