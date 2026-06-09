import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FileUp, Download, CheckCircle2 } from "lucide-react";

interface LeadImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  suppressed: number;
  total: number;
}

// Fields the /api/leads/import backend understands. CSV headers are normalized
// to snake_case and matched against these; unknown columns are ignored.
const KNOWN_FIELDS = [
  "full_name",
  "business_name",
  "email",
  "phone",
  "website",
  "address",
  "category",
  "industry",
  "company",
  "title",
  "linkedin_url",
  "lead_source",
  "priority",
];

const TEMPLATE_HEADERS = [
  "business_name",
  "full_name",
  "email",
  "phone",
  "website",
  "address",
  "category",
  "industry",
  "company",
  "title",
  "linkedin_url",
  "lead_source",
];

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Handle CRLF: skip the \n after \r.
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Don't push blank trailing rows.
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush last field/row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

export default function LeadImportModal({ open, onClose, onImported }: LeadImportModalProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setRows([]);
    setDetectedColumns([]);
    setFileName("");
    setParseError("");
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setParseError("");
    setResult(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        setParseError("CSV needs a header row and at least one data row.");
        setRows([]);
        setDetectedColumns([]);
        return;
      }
      const headers = parsed[0].map(normalizeHeader);
      const mapped = headers.filter((h) => KNOWN_FIELDS.includes(h));
      const dataRows = parsed.slice(1).map((cells) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => {
          if (KNOWN_FIELDS.includes(h) && cells[idx] != null) {
            obj[h] = cells[idx].trim();
          }
        });
        return obj;
      });
      setFileName(file.name);
      setDetectedColumns(mapped);
      setRows(dataRows);
      if (mapped.length === 0) {
        setParseError(
          "No recognized columns. Use headers like business_name, email, phone, website (download the template below).",
        );
      }
    } catch {
      setParseError("Could not read that file.");
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/import", { rows });
      return res.json();
    },
    onSuccess: (data) => {
      const r: ImportResult = data?.data ?? { imported: 0, skipped: 0, duplicates: 0, suppressed: 0, total: 0 };
      setResult(r);
      toast({ title: "Import complete", description: `${r.imported} imported, ${r.duplicates} duplicates, ${r.suppressed} suppressed.` });
      onImported?.();
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const downloadTemplate = () => {
    const csv = TEMPLATE_HEADERS.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clearedge-leads-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-indigo-600" />
            Import leads from CSV
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Import complete</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Imported" value={result.imported} highlight />
              <Stat label="Duplicates skipped" value={result.duplicates} />
              <Stat label="Suppressed skipped" value={result.suppressed} />
              <Stat label="Invalid skipped" value={result.skipped} />
            </div>
            <p className="text-xs text-gray-500">{result.total} rows processed (max 1000 per import).</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={reset}>Import another</Button>
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Upload a CSV with a header row. Recognized columns:{" "}
              <span className="font-mono text-xs">{KNOWN_FIELDS.join(", ")}</span>. A name
              (business_name or full_name) is required per row; rows on the suppression list or
              matching an existing lead are skipped automatically.
            </p>

            <Button variant="outline" size="sm" onClick={downloadTemplate} className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Download template
            </Button>

            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

            {parseError && <p className="text-sm text-red-600">{parseError}</p>}

            {rows.length > 0 && detectedColumns.length > 0 && (
              <div className="text-sm text-gray-700 bg-gray-50 border rounded-md p-3">
                <div><strong>{fileName}</strong></div>
                <div>{rows.length} row(s) ready · columns: <span className="font-mono text-xs">{detectedColumns.join(", ")}</span></div>
                {rows.length > 1000 && (
                  <div className="text-amber-700 mt-1">Only the first 1000 rows will be imported.</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={rows.length === 0 || detectedColumns.length === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? "Importing…" : `Import ${rows.length || ""} lead(s)`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`border rounded-md p-2 ${highlight ? "bg-green-50 border-green-200" : ""}`}>
      <div className={`text-lg font-bold ${highlight ? "text-green-700" : "text-gray-900"}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
