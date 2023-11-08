export async function readJson(file: string) {
  return JSON.parse(await Deno.readTextFile(file))
}
export async function writeJson(file: string, data: object) {
  await Deno.writeTextFile(file, JSON.stringify(data, null, 2))
}
