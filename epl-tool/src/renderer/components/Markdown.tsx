import { Fragment } from 'react';
import { Link } from 'react-router-dom';

// Small Markdown renderer for the bundled Help topics: headings, paragraphs, lists, tables, blockquotes, rules,
// **bold**, *italic*, `code` and [links](...). A line "{{NAME}}" is replaced by blocks[NAME] (generated content).
// Links to "help:<topic>" open that Help topic; http(s) and mailto links are shown as plain text references.

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={key} className="font-semibold text-gray-900">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={key} className="px-1 py-0.5 rounded bg-gray-100 text-[0.85em] font-mono">{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      const [label, href] = lm ? [lm[1], lm[2]] : [t, ''];
      out.push(href.startsWith('help:')
        ? <Link key={key} to={`/help/${href.slice(5)}`} className="text-blue-600 hover:underline">{label}</Link>
        : <span key={key} className="text-blue-700">{label}</span>);
    } else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function Markdown({ source, blocks = {} }: { source: string; blocks?: Record<string, React.ReactNode> }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `md-${k++}`;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    const block = /^\{\{(\w+)\}\}$/.exec(trimmed);
    if (block) { out.push(<Fragment key={key()}>{blocks[block[1]] ?? null}</Fragment>); i++; continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? 'text-2xl font-bold text-gray-900 mb-3' : level === 2 ? 'text-lg font-semibold text-gray-900 mt-6 mb-2' : 'text-base font-semibold text-gray-800 mt-4 mb-1.5';
      const Tag = (`h${level}` as 'h1' | 'h2' | 'h3');
      out.push(<Tag key={key()} className={cls}>{inline(h[2], `h${k}`)}</Tag>);
      i++;
      continue;
    }

    if (/^---+$/.test(trimmed)) { out.push(<hr key={key()} className="my-5 border-gray-200" />); i++; continue; }

    if (trimmed.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      out.push(
        <div key={key()} className="overflow-x-auto my-3">
          <table className="text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50"><tr>{cells(head).map((c, j) => <th key={j} className="text-left px-3 py-1.5 font-medium text-gray-700 border-b border-gray-200">{inline(c, `th${k}-${j}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {body.map((r, ri) => <tr key={ri}>{cells(r).map((c, j) => <td key={j} className="px-3 py-1.5 text-gray-700 align-top">{inline(c, `td${k}-${ri}-${j}`)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quote.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push(<blockquote key={key()} className="my-3 px-4 py-2 border-l-4 border-blue-300 bg-blue-50 text-sm text-gray-700">{inline(quote.join(' '), `q${k}`)}</blockquote>);
      continue;
    }

    const listMatch = /^(\s*)([-*]|\d+\.)\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items: { text: string; nested: boolean }[] = [];
      while (i < lines.length) {
        const lm = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (lm) { items.push({ text: lm[3], nested: lm[1].length >= 2 }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={key()} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-2 space-y-1 text-sm text-gray-700`}>
          {items.map((it, j) => <li key={j} className={it.nested ? 'ml-5 list-[circle]' : ''}>{inline(it.text, `li${k}-${j}`)}</li>)}
        </List>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||>|---|\{\{)/.test(lines[i].trim()) && !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) {
      para.push(lines[i++].trim());
    }
    out.push(<p key={key()} className="text-sm text-gray-700 leading-relaxed my-2">{inline(para.join(' '), `p${k}`)}</p>);
  }

  return <div>{out}</div>;
}
