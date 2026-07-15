export function applyUnifiedPatch(source: string, patch: string): string {
  const sourceLines = source.split("\n");
  const patchLines = patch.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let sourceIndex = 0;
  let index = 0;
  while (index < patchLines.length && !patchLines[index]!.startsWith("@@")) index++;
  if (index === patchLines.length) throw new Error("Patch contains no unified-diff hunks");
  while (index < patchLines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(patchLines[index]!);
    if (!header) throw new Error(`Invalid patch hunk header: ${patchLines[index]}`);
    const oldStart = Number(header[1]) - 1;
    if (oldStart < sourceIndex || oldStart > sourceLines.length) throw new Error("Patch hunk is outside the source file");
    result.push(...sourceLines.slice(sourceIndex, oldStart));
    sourceIndex = oldStart;
    index++;
    while (index < patchLines.length && !patchLines[index]!.startsWith("@@")) {
      const line = patchLines[index]!;
      if (line === "\\ No newline at end of file") { index++; continue; }
      if (line === "" && index === patchLines.length - 1) break;
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " ") {
        if (sourceLines[sourceIndex] !== text) throw new Error(`Patch context mismatch at line ${sourceIndex + 1}`);
        result.push(text); sourceIndex++;
      } else if (marker === "-") {
        if (sourceLines[sourceIndex] !== text) throw new Error(`Patch removal mismatch at line ${sourceIndex + 1}`);
        sourceIndex++;
      } else if (marker === "+") result.push(text);
      else if (line.startsWith("---") || line.startsWith("+++")) { /* header */ }
      else throw new Error(`Invalid patch line: ${line}`);
      index++;
    }
  }
  result.push(...sourceLines.slice(sourceIndex));
  return result.join("\n");
}
