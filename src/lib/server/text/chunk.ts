export type Chunk = {
  index: number;
  content: string;
  heading: string;
};

type ChunkOptions = {
  targetChars?: number;
  maxChars?: number;
};

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

// Normalizes text pulled from NotebookLM exports and PDFs before chunking.
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLong(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) pieces.push(current.trim());
      current = "";
      for (let i = 0; i < sentence.length; i += maxChars) pieces.push(sentence.slice(i, i + maxChars).trim());
      continue;
    }
    if ((current + sentence).length > maxChars && current) {
      pieces.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean);
}

// Splits markdown into heading-aware chunks. Each chunk keeps its nearest heading as context,
// so a chunk like "Hold if under 60" still embeds near "Digoxin".
export function chunkMarkdown(text: string, options: ChunkOptions = {}): Chunk[] {
  const targetChars = options.targetChars ?? 1200;
  const maxChars = options.maxChars ?? 2000;

  type Section = { heading: string; paragraphs: string[] };
  const sections: Section[] = [{ heading: "", paragraphs: [] }];
  const headingStack: string[] = [];

  for (const block of cleanText(text).split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const first = HEADING.exec(lines[0].trim());
    if (first) {
      const depth = first[1].length;
      headingStack.length = depth - 1;
      headingStack[depth - 1] = first[2].trim();
      sections.push({ heading: headingStack.filter(Boolean).join(" > "), paragraphs: [] });
      const rest = lines.slice(1).join("\n").trim();
      if (rest) sections.at(-1)!.paragraphs.push(rest);
      continue;
    }
    if (block.trim()) sections.at(-1)!.paragraphs.push(block.trim());
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    let current = "";
    const flush = () => {
      if (current.trim()) chunks.push({ index: chunks.length, heading: section.heading, content: current.trim() });
      current = "";
    };
    for (const paragraph of section.paragraphs.flatMap((p) => splitLong(p, maxChars))) {
      if (current && current.length + paragraph.length + 2 > targetChars) flush();
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    flush();
  }
  return chunks;
}

// The text that gets embedded: heading context plus the chunk body.
export function embeddingText(chunk: Chunk, sourceTitle: string): string {
  return [sourceTitle, chunk.heading, chunk.content].filter(Boolean).join("\n");
}
