export type PreviewDocumentToken<Document> = Readonly<{
  generation: number;
  document: Document;
}>;

export function capturePreviewDocumentToken<Document>(
  generation: number,
  document: Document,
): PreviewDocumentToken<Document> {
  return { generation, document };
}

export function previewDocumentTokenIsCurrent<Document>(
  token: PreviewDocumentToken<Document>,
  generation: number,
  document: Document | null,
): boolean {
  return token.generation === generation && token.document === document;
}
