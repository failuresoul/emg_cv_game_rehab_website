import { api } from "@/lib/api";

/**
 * Downloads a file from the API with the user's login (a plain link would not send it), and
 * saves it under `filename`. Rejects if the request fails.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await api.get<Blob>(path, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // After the click has been handled, so the browser has the file first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
