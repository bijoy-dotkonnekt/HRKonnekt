// The small slice of Markdown the agents write: **bold**, *italic*, `code`, headings, - and 1. lists, | tables |.
// Builds React elements (text is escaped by React); no HTML from the agent is ever injected.
// ponytail: hand-rolled for these cases; swap for a Markdown library if agents start sending links or nested lists.

import { memo } from "react";

function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const t = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k} className="font-semibold">{inline(t.slice(2, -2), m.index)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-raised px-1 font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{inline(t.slice(1, -1), m.index)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isRule = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row);

// Memoised on the text: a new message re-renders the whole chat, but old messages don't need parsing again.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) body.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>{head.map((h, j) => <th key={j} className="border-b border-line py-1 pr-3 font-medium">{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-line/60 py-1 pr-3">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      blocks.push(<p key={k} className="font-semibold">{inline(h[1])}</p>);
      i++;
      continue;
    }
    const list = (re: RegExp) => {
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
      return items;
    };
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = list(/^\s*[-*•]\s+/);
      blocks.push(<ul key={k} className="list-disc space-y-0.5 pl-5">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = list(/^\s*\d+[.)]\s+/);
      blocks.push(<ol key={k} className="list-decimal space-y-0.5 pl-5">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(\s*[-*•]\s+|\s*\d+[.)]\s+|#{1,6}\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(
      <p key={k}>
        {para.map((p, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(p, j)}
          </span>
        ))}
      </p>,
    );
  }
  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
});
