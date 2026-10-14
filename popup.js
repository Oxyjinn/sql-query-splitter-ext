document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("sql-input");
  const splitBtn = document.getElementById("split-btn");
  const resultsDiv = document.getElementById("results");

  const outSelect = document.getElementById("out-select");
  const outFrom = document.getElementById("out-from");

  // Load saved SQL query when popup opens
  chrome.storage.local.get(["savedSql"], (result) => {
    if (result.savedSql) {
      inputEl.value = result.savedSql;
    }
  });

  // Save SQL query automatically as you type/paste
  inputEl.addEventListener("input", () => {
    chrome.storage.local.set({ savedSql: inputEl.value });
  });

  // Split Button Logic
  splitBtn.addEventListener("click", () => {
    const rawSql = inputEl.value.trim();
    if (!rawSql) return;

    // 1. Break ALL queries (including CTE subqueries) into main blocks
    const parsed = parseTopLevelSQL(rawSql);

    // 2. Format SELECT blocks individually, then join them with spacing
    if (parsed.selectArray && parsed.selectArray.length > 0) {
      const formattedSelects = parsed.selectArray.map(block => formatClause(block, "SELECT"));
      outSelect.value = formattedSelects.join("\n\n------ Next Query / Subquery ------\n\n");
    } else {
      outSelect.value = "(None)";
    }
    
    // 3. Extract BASE TABLES in "CODE - TABLENAME" format (Unique across all queries)
    outFrom.value = extractBaseTables(rawSql) || "(None)";

    resultsDiv.style.display = "block";
  });

  // Copy button logic
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
 * Extracts physical tables and aliases uniquely across ALL queries in the text.
 */
function extractBaseTables(sql) {
  // Clean comments and OBIEE brackets
  let s = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/\[\[|\]\]/g, " "); 
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "''"); 
  
  const extractedPairs = new Map();
  const regex = /("[^"]+"|`[^`]+`|\[[^\]]+\]|[a-zA-Z0-9_\$#.]+|,|\(\vert{}\)|FROM|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|WHERE|GROUP|HAVING|ORDER|LIMIT|SELECT|AS|ON|USING|UNION|ALL|INTERSECT|MINUS)/gi;
  const tokens = s.match(regex);
  
  if (!tokens) return "";
  
  let expectingTable = false;
  let i = 0;
  
  while(i < tokens.length) {
    const tok = tokens[i].toUpperCase();
    
    if (tok === 'FROM' || tok === 'JOIN') {
      expectingTable = true;
      i++;
      continue;
    }
    
    if (expectingTable) {
      if (tok === '(') {
        expectingTable = false;
        i++;
        continue;
      }
      
      const stopWords = ['WHERE','GROUP','HAVING','ORDER','LIMIT','SELECT','ON','USING','LEFT','RIGHT','INNER','FULL','OUTER','CROSS','JOIN','UNION','ALL','INTERSECT','MINUS'];
      if (stopWords.includes(tok)) {
        expectingTable = false;
        continue;
      }
      
      let tableName = tokens[i];
      let alias = "";
      
      if (i + 1 < tokens.length) {
        const nextTok = tokens[i+1].toUpperCase();
        if (nextTok === 'AS') {
          if (i + 2 < tokens.length) {
            alias = tokens[i+2];
            i += 2;
          }
        } else if (!stopWords.includes(nextTok) && nextTok !== ',' && nextTok !== '(' && nextTok !== ')') {
          alias = tokens[i+1];
          i++;
        }
      }
      
      const uniqueKey = `${tableName}||${alias}`;
      if (!extractedPairs.has(uniqueKey)) {
        extractedPairs.set(uniqueKey, { table: tableName, code: alias || "" });
      }
      
      if (i + 1 < tokens.length && tokens[i+1] === ',') {
        expectingTable = true;
        i++;
      } else {
        expectingTable = false;
      }
    }
    i++;
  }
  
  const lines = [];
  extractedPairs.forEach((val) => {
    if (val.code) {
      lines.push(`${val.code} - ${val.table}`);
    } else {
      lines.push(val.table);
    }
  });
  
  return lines.join("\n");
}

/**
 * Formats a specific clause by inserting line breaks safely 
 */
function formatClause(text, type) {
  if (!text || text === "(None)") return text;

  let result = "";
  let parenDepth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if ((char === "'" || char === '"') && text[i - 1] !== "\\") {
      if (!inString) { inString = true; stringChar = char; }
      else if (stringChar === char) { inString = false; }
    }

    if (!inString) {
      if (char === "(") parenDepth++;
      if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    }

    if (parenDepth === 0 && !inString) {
      if (type === "SELECT" && char === ",") {
        result += ",\n";
        let nextIdx = i + 1;
        while (nextIdx < text.length && /\s/.test(text[nextIdx])) nextIdx++;
        i = nextIdx - 1;
        continue;
      }
    }
    result += char;
  }

  return result
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');
}

/**
 * Intelligently extracts SELECT clauses by finding SELECT and stopping at the matching FROM.
 */
function parseTopLevelSQL(sql) {
  const cleanSql = sql.replace(/--.*\$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\[\[\vert{}\]\]/g, " ").trim();
  
  let parenDepth = 0;
  let inString = false;
  let stringChar = "";
  
  const selectBlocks = [];
  let currentSelect = null;
  
  const isWordChar = (c) => /[a-zA-Z0-9_\$]/.test(c);

  for (let i = 0; i < cleanSql.length; i++) {
    const char = cleanSql[i];
    
    // Ignore keywords inside strings
    if ((char === "'" || char === '"') && cleanSql[i - 1] !== "\\") {
      if (!inString) { inString = true; stringChar = char; }
      else if (stringChar === char) { inString = false; }
      continue;
    }
    if (inString) continue;

    if (char === "(") parenDepth++;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (!currentSelect) {
      // We are not inside a SELECT block. Look for "SELECT" (with optional DISTINCT/ALL)
      const rest = cleanSql.substring(i);
      const match = rest.match(/^SELECT(\s+DISTINCT|\s+ALL)?\b/i);
      
      if (match) {
        const prevChar = i === 0 ? " " : cleanSql[i - 1];
        if (!isWordChar(prevChar)) {
          // Found a valid SELECT block starting point
          currentSelect = {
            start: i + match[0].length,
            depth: parenDepth // Record the depth so we only stop at the matching FROM
          };
          i += match[0].length - 1; // Skip past the SELECT keyword
        }
      }
    } else {
      // We are currently extracting a SELECT block. Stop only when we find FROM at the exact same depth!
      const rest = cleanSql.substring(i);
      const matchFrom = rest.match(/^FROM\b/i);
      
      if (matchFrom && parenDepth === currentSelect.depth) {
        const prevChar = cleanSql[i - 1];
        if (!isWordChar(prevChar)) {
          // Found the matching FROM. Extract the content.
          let content = cleanSql.substring(currentSelect.start, i).trim();
          if (content.length > 0) {
            selectBlocks.push(content);
          }
          currentSelect = null; // Reset to start looking for the next SELECT
          i += 3; // Skip past the FROM keyword
        }
      }
    }
  }

  // Fallback: If the query ends abruptly without a FROM (e.g. `SELECT 1`)
  if (currentSelect) {
    let content = cleanSql.substring(currentSelect.start).trim();
    if (content.length > 0) {
      selectBlocks.push(content);
    }
  }

  return {
    selectArray: selectBlocks
  };
}