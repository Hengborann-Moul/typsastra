const TEXT_INPUT_SELECTOR = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="number"]',
  'input[type="email"]',
  'input[type="url"]',
  'input[type="tel"]',
  'input[type="password"]',
  "textarea"
].join(",");

export function desktopInputAttributes(): Readonly<Record<string, string>> {
  return {
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false"
  };
}

function applyDesktopInputAttributes(control: Element): void {
  for (const [name, value] of Object.entries(desktopInputAttributes())) {
    control.setAttribute(name, value);
  }
}

function applyWithin(root: ParentNode): void {
  if (root instanceof Element && root.matches(TEXT_INPUT_SELECTOR)) {
    applyDesktopInputAttributes(root);
  }
  root.querySelectorAll(TEXT_INPUT_SELECTOR).forEach(applyDesktopInputAttributes);
}

export function initializeDesktopInputPolicy(doc: Document = document): MutationObserver {
  applyWithin(doc);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node instanceof Element) applyWithin(node);
      });
    }
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  return observer;
}
