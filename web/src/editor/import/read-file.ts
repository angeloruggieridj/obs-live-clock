// SPDX-License-Identifier: GPL-2.0-or-later

/** `Blob.text()` where it exists, a FileReader otherwise (old CEF, some test environments). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
