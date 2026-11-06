export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

export function stripHtml(value: string): string {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function firstMatch(
  input: string,
  expression: RegExp,
): string | undefined {
  return expression.exec(input)?.[1]?.trim();
}

export function absoluteProviderUrl(
  value: string,
  base: string,
  hostnameSuffix: string,
): string {
  const url = new URL(decodeHtml(value), base);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== hostnameSuffix &&
      !url.hostname.endsWith(`.${hostnameSuffix}`))
  ) {
    throw new Error(`Provider returned an untrusted URL host: ${url.hostname}`);
  }
  return url.toString();
}
