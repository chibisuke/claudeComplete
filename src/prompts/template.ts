/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}
