// A faster drop-in for csv-reader 1.0.0: run(input) returns its exact {columns, rows, errors} answer. The text is read
// once, left to right, over UTF-16 code units (comma 44, quote 34, LF 10, CR 13): a field is a slice of the text, never
// built character by character, and the read keeps its state in local variables, so the hot loop runs on registers.
//
// The policy is csv-reader 1.0.0's, read for read:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each
//     CRLF or lone CR inside it is read as LF; what follows its closing quote, up to the next comma or line break,
//     is appended as it stands (quote_junk, when the field ends); a quote that never closes is read as a literal
//     character and the text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record
//     when header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone CR
//     inside a quoted field counted), row its record's index in rows (null for the header), in the order met, a
//     field's quote_junk when the field ends and a record's short_row or long_row when the record ends.
//
// Pure: no clock, no randomness, nothing kept from one call to the next.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

const COMMA_CODE = 44;
const QUOTE = 34;
const LF = 10;
const CR = 13;

/**
 * Reads unquoted characters from `pos` onto `prefix`: a CR not followed by LF is dropped (stray_cr, at
 * `recordLine`/`recordRow`), and the field ends at the next comma, line break or end of the text. The rare paths
 * only (junk after a closing quote, a quote that never closes), so it returns its state instead of holding any.
 */
function readUnquoted(text, len, pos, line, prefix, errors, recordLine, recordRow) {
  let value = prefix;
  let flushed = 0;
  let start = pos;
  let i = pos;
  let ended = -1;
  let advance = 0;
  while (i < len) {
    const c = text.charCodeAt(i);
    if (c === COMMA_CODE) {
      ended = COMMA;
      advance = 1;
      break;
    }
    if (c === LF) {
      ended = LINE_BREAK;
      advance = 1;
      break;
    }
    if (c === CR) {
      if (text.charCodeAt(i + 1) === LF) {
        ended = LINE_BREAK;
        advance = 2;
        break;
      }
      value = value + text.slice(start, i);
      flushed += i - start;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      i += 1;
      start = i;
      continue;
    }
    i += 1;
  }
  if (ended < 0) ended = END;
  const tail = text.slice(start, i);
  value = flushed === 0 ? (prefix === '' ? tail : prefix + tail) : value + tail;
  return { value, ended, pos: i + advance, line: ended === LINE_BREAK ? line + 1 : line, added: flushed + (i - start) };
}

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = typeof input.text === 'string' ? input.text : String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next code unit to read
  let line = 1; // the line it is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  while (true) {
    // Lines left with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = COMMA;

    while (ended === COMMA) {
      quoted = text.charCodeAt(pos) === QUOTE;
      if (!quoted) {
        // An unquoted field: its value runs to the next comma or line break.
        let i = pos;
        let stop = -1;
        let advance = 0;
        while (i < len) {
          const c = text.charCodeAt(i);
          if (c === COMMA_CODE) {
            stop = COMMA;
            advance = 1;
            break;
          }
          if (c === LF) {
            stop = LINE_BREAK;
            advance = 1;
            break;
          }
          if (c === CR) {
            if (text.charCodeAt(i + 1) === LF) {
              stop = LINE_BREAK;
              advance = 2;
            }
            break;
          }
          i += 1;
        }
        if (stop < 0 && i >= len) {
          fields.push(text.slice(pos));
          pos = len;
          ended = END;
          continue;
        }
        if (stop < 0) {
          // A stray CR: the general reader drops it (stray_cr) and reads the field on.
          const r = readUnquoted(text, len, pos, line, '', errors, recordLine, recordRow);
          fields.push(r.value);
          pos = r.pos;
          line = r.line;
          ended = r.ended;
          continue;
        }
        fields.push(text.slice(pos, i));
        pos = i + advance;
        if (stop === LINE_BREAK) line += 1;
        ended = stop;
        continue;
      }

      // A quoted field: its opening quote is at pos, and its value is the runs between escapes.
      const open = pos;
      const openLine = line;
      let seg = pos + 1;
      pos = seg;
      let value = '';
      let segments = 0;
      let closed = false;
      while (pos < len) {
        const c = text.charCodeAt(pos);
        if (c === QUOTE) {
          if (segments === 0) value = text.slice(seg, pos);
          else value = value + text.slice(seg, pos);
          segments += 1;
          if (text.charCodeAt(pos + 1) === QUOTE) {
            value = value + '"';
            pos += 2;
            seg = pos;
            continue;
          }
          pos += 1;
          closed = true;
          break;
        }
        if (c === CR) {
          // CRLF and a lone CR inside quotes are each one LF.
          if (segments === 0) value = text.slice(seg, pos);
          else value = value + text.slice(seg, pos);
          value = value + '\n';
          segments += 1;
          line += 1;
          pos += text.charCodeAt(pos + 1) === LF ? 2 : 1;
          seg = pos;
          continue;
        }
        if (c === LF) line += 1;
        pos += 1;
      }
      if (segments === 0) value = '';
      if (!closed) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        const r = readUnquoted(text, len, open + 1, openLine, '"', errors, recordLine, recordRow);
        fields.push(r.value);
        pos = r.pos;
        line = r.line;
        ended = r.ended;
        continue;
      }
      if (pos >= len) {
        fields.push(value);
        ended = END;
        continue;
      }
      const c = text.charCodeAt(pos);
      if (c === COMMA_CODE) {
        pos += 1;
        fields.push(value);
        ended = COMMA;
        continue;
      }
      if (c === LF) {
        pos += 1;
        line += 1;
        fields.push(value);
        ended = LINE_BREAK;
        continue;
      }
      if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
        fields.push(value);
        ended = LINE_BREAK;
        continue;
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const r = readUnquoted(text, len, pos, line, value, errors, recordLine, recordRow);
      if (r.added !== 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      fields.push(r.value);
      pos = r.pos;
      line = r.line;
      ended = r.ended;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? columns ?? [] : null, rows, errors };
}
