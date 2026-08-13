export type PreviewLinkTarget =
  | { kind: "external"; url: string }
  | { kind: "destination"; destination: string | unknown[] }
  | { kind: "draft-image"; id: string };

const DRAFT_IMAGE_LINK_PREFIX = "https://draft-preview.typsastra.invalid/";

export function previewLinkTarget(annotation: unknown): PreviewLinkTarget | null {
  if (!annotation || typeof annotation !== "object") return null;
  const candidate = annotation as { subtype?: unknown; url?: unknown; dest?: unknown };
  if (candidate.subtype !== "Link") return null;
  if (typeof candidate.url === "string" && candidate.url.length > 0) {
    if (candidate.url.startsWith(DRAFT_IMAGE_LINK_PREFIX)) {
      const id = candidate.url.slice(DRAFT_IMAGE_LINK_PREFIX.length);
      return /^[a-f0-9]{24}$/.test(id) ? { kind: "draft-image", id } : null;
    }
    return { kind: "external", url: candidate.url };
  }
  if (typeof candidate.dest === "string" || Array.isArray(candidate.dest)) {
    return { kind: "destination", destination: candidate.dest };
  }
  return null;
}

export function previewLinkModifierPressed(event: Pick<MouseEvent | KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  return event.ctrlKey || event.metaKey;
}

export function previewLinkModifierAfterKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">,
  phase: "keydown" | "keyup",
): boolean {
  if (phase === "keydown" && (event.key === "Control" || event.key === "Meta")) return true;
  // Some Linux WebKitGTK builds retain the released modifier in the keyup
  // event. The other command modifier can still legitimately remain held.
  if (phase === "keyup" && event.key === "Control") return event.metaKey;
  if (phase === "keyup" && event.key === "Meta") return event.ctrlKey;
  return previewLinkModifierPressed(event);
}
