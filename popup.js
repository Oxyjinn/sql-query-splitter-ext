document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("sql-input");
  const splitBtn = document.getElementById("split-btn");
  const resultsDiv = document.getElementById("results");

  const outSelect = document.getElementById("out-select");
  const outFrom = document.getElementById("out-from");
  const outFilter = document.getElementById("out-filter");
  const outOther = document.getElementById("out-other");

  splitBtn.addEventListener("click", () => {
    const rawSql = inputEl.value.trim();
    if (!rawSql) return;

    const parsed = parseTopLevelSQL(rawSql);

    outSelect.value = parsed.select || "(None)";
    outFrom.value = parsed.from || "(None)";
    
    // Group WHERE and HAVING clauses under FILTER
    const filters = [];
    if (parsed.where) filters.push(`WHERE ${parsed.where}`);
    if (parsed.having) filters.push(`HAVING ${parsed.having}`);
    outFilter.value = filters.join("\n\n") || "(None)";

    // Group other supplementary clauses
    const others = [];
    if (parsed.groupBy) others.push(`GROUP BY ${parsed.groupBy}`);
    if (parsed.orderBy) others.push(`ORDER BY ${parsed.orderBy}`);
    if (parsed.limit) others.push(`LIMIT ${parsed.limit}`);
    outOther.value = others.join("\n") || "(None)";

    resultsDiv.style.display = "block";
  });

  // Copy to clipboard helper
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetId = e.target.getAttribute("data-target");
      const targetEl = document.getElementById(targetId);
      if (targetEl && targetEl.value) {
        navigator.clipboard.writeText(targetEl.value);
        const originalText = e.target.innerText;
        e.target.innerText = "Copied!";
        setTimeout(() => (e.target.innerText = originalText), 1200);
      }
    });
  });
});

/**
 * Parses top-level clauses by tracking quotes and parenthesis depth.
 */
function parseTopLevelSQL(sql) {
  // Strip trailing semicolons and comments
  const cleanSql = sql
    .replace(/--.*\$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/;+\s*\$/, "")
    .trim();

  const majorKeywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "GROUP BY",
    "HAVING",
    "ORDER BY",
    "LIMIT"
  ];

  let parenDepth = 0;
  let inString = false;
  let stringChar = "";
  
  // Find top-level keyword boundary positions
  const boundaries = [];
  const len = cleanSql.length;

  for (let i = 0; i < len; i++) {
    const char = cleanSql[i];

    // String literal boundary check ('...' or "...")
    if ((char === "'" || char === '"') && cleanSql[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (stringChar === char) {
        inString = false;
      }
      continue;
    }

    if (inString) continue;

    // Subquery parenthesis tracking
    if (char === "(") parenDepth++;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

    // Only match keywords when at the root level (depth === 0)
    if (parenDepth === 0) {
      for (const kw of majorKeywords) {
        const slice = cleanSql.substring(i, i + kw.length).toUpperCase();
        if (slice === kw) {
          // Verify word boundary before and after keyword
          const prevChar = cleanSql[i - 1] || " ";
          const nextChar = cleanSql[i + kw.length] || " ";

          if (/\s/.test(prevChar) && /\s/.test(nextChar)) {
            boundaries.push({ keyword: kw, start: i, end: i + kw.length });
            i += kw.length - 1;
            break;
          }
        }
      }
    }
  }

  // Extract text slice for each clause
  const result = {
    select: "",
    from: "",
    where: "",
    groupBy: "",
    having: "",
    orderBy: "",
    limit: ""
  };

  const keyMap = {
    "SELECT": "select",
    "FROM": "from",
    "WHERE": "where",
    "GROUP BY": "groupBy",
    "HAVING": "having",
    "ORDER BY": "orderBy",
    "LIMIT": "limit"
  };

  for (let b = 0; b < boundaries.length; b++) {
    const current = boundaries[b];
    const nextStart = (b + 1 < boundaries.length) ? boundaries[b + 1].start : cleanSql.length;
    const clauseContent = cleanSql.substring(current.end, nextStart).trim();
    const mappedKey = keyMap[current.keyword];
    if (mappedKey) {
      result[mappedKey] = clauseContent;
    }
  }

  return result;
}