export type SpeakerSegment =
  | { kind: "narration"; text: string }
  | { kind: "speaker"; name: string; text: string };

const SPEAKER_TAG_RE = /<speaker="([^"]*)">([\s\S]*?)<\/speaker>/g;

export function parseSpeakerTags(text: string): SpeakerSegment[] | null {
  const regex = new RegExp(SPEAKER_TAG_RE.source, SPEAKER_TAG_RE.flags);
  const segments: SpeakerSegment[] = [];
  let lastIndex = 0;
  let foundTag = false;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    foundTag = true;

    if (match.index > lastIndex) {
      segments.push({ kind: "narration", text: text.slice(lastIndex, match.index) });
    }

    segments.push({ kind: "speaker", name: match[1]!, text: match[2]! });
    lastIndex = match.index + match[0].length;
  }

  if (!foundTag) return null;

  if (lastIndex < text.length) {
    segments.push({ kind: "narration", text: text.slice(lastIndex) });
  }

  return segments;
}

export function stripSpeakerTags(text: string): string {
  return parseSpeakerTags(text)
    ?.map((segment) => segment.text)
    .join("") ?? text;
}
