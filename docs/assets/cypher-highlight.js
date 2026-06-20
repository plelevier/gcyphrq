// Lightweight Cypher keyword highlighter + copy buttons for code blocks
document.addEventListener('DOMContentLoaded', () => {
  // Highlight Cypher keywords
  document.querySelectorAll('.language-cypher').forEach(el => {
    const text = el.textContent;
    const tokens = tokenize(text);
    el.innerHTML = tokens.map(t => {
      if (t.type === 'keyword') return `<span class="cy-kw">${t.text}</span>`;
      if (t.type === 'function') return `<span class="cy-fn">${t.text}</span>`;
      if (t.type === 'label') return `<span class="cy-label">${t.text}</span>`;
      if (t.type === 'reltype') return `<span class="cy-rel">${t.text}</span>`;
      if (t.type === 'string') return `<span class="cy-str">${t.text}</span>`;
      if (t.type === 'number') return `<span class="cy-num">${t.text}</span>`;
      if (t.type === 'comment') return `<span class="cy-cmt">${t.text}</span>`;
      return escapeHtml(t.text);
    }).join('');
  });

  // Add copy button to every code block
  document.querySelectorAll('.highlight').forEach(block => {
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.type = 'button';
    btn.title = 'Copy';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    // Wrap block + btn in a relative container
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    block.parentNode.replaceChild(wrapper, block);
    wrapper.appendChild(block);
    wrapper.appendChild(btn);

    btn.addEventListener('click', () => {
      const code = block.querySelector('code') || block;
      const text = code.textContent.trim();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1500);
        });
      } else {
        // Fallback for non-HTTPS (local dev)
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
      }
    });
  });
});

function tokenize(src) {
  const tokens = [];
  const keywords = new Set([
    'MATCH', 'OPTIONAL', 'UNWIND', 'RETURN', 'WITH', 'WHERE',
    'CREATE', 'MERGE', 'SET', 'DELETE', 'REMOVE', 'FOREACH',
    'ORDER', 'BY', 'ASC', 'DESC', 'SKIP', 'LIMIT',
    'ON', 'UPDATE',
    'AND', 'OR', 'XOR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
    'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'STARTS', 'ENDS', 'CONTAINS',
  ]);
  const functions = new Set([
    'count', 'sum', 'min', 'max', 'avg', 'collect',
    'head', 'tail', 'size', 'id', 'labels', 'properties',
    'type', 'nodes', 'relationships',
    'toString', 'toInt', 'toFloat', 'toBoolean',
    'coalesce', 'exists',
  ]);

  let i = 0;
  while (i < src.length) {
    // Comments
    if (src[i] === '/' && src[i + 1] === '/') {
      let end = src.indexOf('\n', i);
      if (end === -1) end = src.length;
      tokens.push({ type: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }

    // Strings (single or double quoted)
    if (src[i] === "'" || src[i] === '"') {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j++; // skip escaped char
        j++;
      }
      j++; // closing quote
      tokens.push({ type: 'string', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(src[i]) && (i === 0 || /[\s(,<>!=+\-*\/]/.test(src[i - 1]))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: 'number', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Labels :Label
    if (src[i] === ':' && i + 1 < src.length && /[A-Za-z_]/.test(src[i + 1])) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      tokens.push({ type: 'label', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Relationship types -[TYPE]-> or :TYPE
    if (src[i] === '-' && src[i + 1] === '[') {
      // Find the relationship type
      let j = i + 2;
      // skip whitespace
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j < src.length && (src[j] === '>' || src[j] === '<' || /[A-Za-z_]/.test(src[j]))) {
        if (/[A-Za-z_]/.test(src[j])) {
          let k = j;
          while (k < src.length && /[A-Za-z_0-9]/.test(src[k])) k++;
          tokens.push({ type: 'text', text: src.slice(i, j) });
          tokens.push({ type: 'reltype', text: src.slice(j, k) });
          i = k;
          continue;
        }
      }
    }

    // Identifiers / keywords / functions
    if (/[A-Za-z_]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const upper = word.toUpperCase();
      if (keywords.has(upper)) {
        tokens.push({ type: 'keyword', text: word });
      } else if (functions.has(word.toLowerCase()) && j < src.length && src[j] === '(') {
        tokens.push({ type: 'function', text: word });
      } else {
        tokens.push({ type: 'text', text: word });
      }
      i = j;
      continue;
    }

    // Everything else
    tokens.push({ type: 'text', text: src[i] });
    i++;
  }

  return tokens;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
