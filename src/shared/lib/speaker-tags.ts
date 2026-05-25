export type SpeakerSegment =
  | { kind: "narration"; text: string }
  | { kind: "speaker"; name: string; text: string };

export interface ParseSpeakerTagsOptions {
  allowBare?: boolean;
}

const NAMED_SPEAKER_TAG_RE = /<speaker="([^"]*)">([\s\S]*?)<\/speaker>/g;
const BARE_OR_NAMED_SPEAKER_TAG_RE = /<speaker(?:="([^"]*)")?>([\s\S]*?)<\/speaker>/g;

export function parseSpeakerTags(text: string, options: ParseSpeakerTagsOptions = {}): SpeakerSegment[] | null {
  const source = options.allowBare ? BARE_OR_NAMED_SPEAKER_TAG_RE : NAMED_SPEAKER_TAG_RE;
  const regex = new RegExp(source.source, source.flags);
  const segments: SpeakerSegment[] = [];
  let lastIndex = 0;
  let foundTag = false;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    foundTag = true;

    if (match.index > lastIndex) {
      segments.push({ kind: "narration", text: text.slice(lastIndex, match.index) });
    }

    segments.push({ kind: "speaker", name: (match[1] ?? "").trim(), text: match[2]! });
    lastIndex = match.index + match[0].length;
  }

  if (!foundTag) return null;

  if (lastIndex < text.length) {
    segments.push({ kind: "narration", text: text.slice(lastIndex) });
  }

  return segments;
}

export function stripSpeakerTags(text: string, options: ParseSpeakerTagsOptions = {}): string {
  return parseSpeakerTags(text, options)
    ?.map((segment) => segment.text)
    .join("") ?? text;
}
