export function getComposeTtyArgs(
  stdinIsTerminal = Deno.stdin.isTerminal(),
  stdoutIsTerminal = Deno.stdout.isTerminal(),
) {
  return stdinIsTerminal && stdoutIsTerminal ? ["-it"] : ["-T"];
}
