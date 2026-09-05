/** A file the server named and the browser should save. */
export interface DownloadedFile {
  filename: string;
  blob: Blob;
}

/**
 * Pulls the filename out of a `Content-Disposition` header.
 *
 * The server names every download it sends, so the name on disk matches the one
 * in the response rather than being reinvented on the client. `fallback` covers
 * a proxy that strips the header.
 */
export function filenameFrom(header: unknown, fallback: string): string {
  const match = typeof header === 'string' ? /filename="([^"]+)"/.exec(header) : null;

  return match?.[1] ?? fallback;
}

/**
 * Hands a downloaded file to the browser.
 *
 * Built from an object URL rather than pointing an `<a href>` at the endpoint,
 * because these requests need the `Authorization` header the axios client
 * attaches — a plain link would arrive without it and get a 401. The URL is
 * revoked on the next tick; revoking synchronously races the download in Safari.
 */
export function saveFile({ filename, blob }: DownloadedFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
