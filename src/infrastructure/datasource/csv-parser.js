export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...records] = rows.filter((currentRow) => currentRow.some((cell) => cell !== ''));

  if (!headers) {
    return [];
  }

  return records.map((record) => Object.fromEntries(
    headers.map((header, index) => [header, record[index] ?? ''])
  ));
}

export function stringifyCsv(records) {
  if (records.length === 0) {
    return '';
  }

  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const lines = [
    headers.map(escapeCsvValue).join(','),
    ...records.map((record) => headers.map((header) => escapeCsvValue(record[header] ?? '')).join(','))
  ];

  return `${lines.join('\n')}\n`;
}

function escapeCsvValue(value) {
  const stringValue = String(value);
  return `"${stringValue.replaceAll('"', '""')}"`;
}
