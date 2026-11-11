import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { t, type TranslationKey } from "@/i18n";
import { downloadFile } from "@/lib/download";

/** Downloads a CSV export from the API, with a gentle message if it fails. */
export function ExportButton({
  path,
  filename,
  labelKey,
}: {
  path: string;
  filename: string;
  labelKey: TranslationKey;
}) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      await downloadFile(path, filename);
    } catch {
      showToast("error", t("adminMetrics.exportFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" loading={busy} onClick={() => void download()}>
      {!busy && <Download size={20} aria-hidden />}
      {t(labelKey)}
    </Button>
  );
}
