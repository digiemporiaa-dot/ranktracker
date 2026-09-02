'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, Plus } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { MAX_CSV_BYTES, parseKeywordCsv, parseKeywordList } from '@/lib/csv';

type Preview = {
  keywords: { keyword: string; targetUrl: string | null }[];
  totalParsed: number;
  duplicates: number;
  skippedRows: number;
  warnings: string[];
};

/**
 * Keyword entry — CSV upload with a preview step, and a paste box.
 *
 * The CSV is parsed in the browser to render the preview instantly; the server
 * re-parses the same file on import, so the browser's copy is never trusted.
 */
export function KeywordImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<'csv' | 'paste'>('csv');
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setCsvText(null);
    setFileName(null);
    setPreview(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setNotice(null);

    if (file.size > MAX_CSV_BYTES) {
      setError(`That file is too large. The limit is ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB.`);
      reset();
      return;
    }

    const text = await file.text();
    const parsed = parseKeywordCsv(text);

    if (parsed.keywords.length === 0) {
      setError(parsed.errors[0] ?? 'No valid keywords were found in that file.');
      reset();
      return;
    }

    setCsvText(text);
    setFileName(file.name);
    setPreview({
      keywords: parsed.keywords,
      totalParsed: parsed.keywords.length,
      duplicates: parsed.duplicates,
      skippedRows: parsed.skippedRows,
      warnings: parsed.errors,
    });
  }

  async function commitCsv() {
    if (!csvText) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/keywords/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText, commit: true }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The keywords could not be imported. Please try again.');
        return;
      }

      setNotice(
        `Imported ${data.created} keyword${data.created === 1 ? '' : 's'}${
          data.skipped ? `, skipped ${data.skipped} already in this project` : ''
        }.`,
      );
      reset();
      router.refresh();
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setPending(false);
    }
  }

  async function commitPaste() {
    const parsed = parseKeywordList(pasteText);
    if (parsed.keywords.length === 0) {
      setError(parsed.errors[0] ?? 'Please enter at least one keyword.');
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The keywords could not be added. Please try again.');
        return;
      }

      setNotice(
        `Added ${data.created} keyword${data.created === 1 ? '' : 's'}${
          data.skipped ? `, skipped ${data.skipped} already in this project` : ''
        }.`,
      );
      setPasteText('');
      router.refresh();
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setPending(false);
    }
  }

  const pastePreview = pasteText.trim() ? parseKeywordList(pasteText) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add keywords</CardTitle>
        <CardDescription>Upload a CSV file or paste your keywords, one per line.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="inline-flex rounded-lg bg-secondary p-1">
          {(['csv', 'paste'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setError(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === value ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {value === 'csv' ? 'Import CSV' : 'Paste keywords'}
            </button>
          ))}
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        {tab === 'csv' ? (
          <div className="space-y-4">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />

            <p className="text-xs text-muted-foreground">
              Expected columns: <code className="font-mono">keyword</code>, and optionally{' '}
              <code className="font-mono">targetUrl</code>.
            </p>

            {preview ? (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    Preview — {preview.totalParsed} keyword
                    {preview.totalParsed === 1 ? '' : 's'} from {fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.duplicates} duplicate{preview.duplicates === 1 ? '' : 's'} and{' '}
                    {preview.skippedRows} empty row{preview.skippedRows === 1 ? '' : 's'} removed
                  </p>
                </div>

                {preview.warnings.length > 0 ? (
                  <Alert tone="info">{preview.warnings.join(' ')}</Alert>
                ) : null}

                <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Keyword
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Target URL
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.keywords.slice(0, 100).map((row, index) => (
                        <tr key={`${row.keyword}-${index}`} className="border-t border-border">
                          <td className="px-3 py-1.5">{row.keyword}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {row.targetUrl ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-2">
                  <Button onClick={commitCsv} disabled={pending}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                    Import {preview.totalParsed} keyword{preview.totalParsed === 1 ? '' : 's'}
                  </Button>
                  <Button variant="outline" onClick={reset} disabled={pending}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'microsoft reseller india\nazure reseller india\nmicrosoft partner india'}
              rows={8}
            />
            {pastePreview ? (
              <p className="text-xs text-muted-foreground">
                {pastePreview.keywords.length} keyword
                {pastePreview.keywords.length === 1 ? '' : 's'} ready
                {pastePreview.duplicates > 0
                  ? ` · ${pastePreview.duplicates} duplicate${pastePreview.duplicates === 1 ? '' : 's'} removed`
                  : ''}
              </p>
            ) : null}
            <Button onClick={commitPaste} disabled={pending || !pasteText.trim()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add keywords
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
