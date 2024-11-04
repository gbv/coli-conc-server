export async function readJson(file) {
  return JSON.parse(await Deno.readTextFile(file))
}
export async function writeJson(file, data) {
  await Deno.writeTextFile(file, JSON.stringify(data, null, 2))
}
