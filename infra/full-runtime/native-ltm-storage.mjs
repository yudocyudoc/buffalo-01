function table(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS native_ltm_parts (run_id TEXT, kind TEXT, part INTEGER, body TEXT NOT NULL, PRIMARY KEY(run_id,kind,part))');
}

// A native integration grid can exceed the SQLite row limit. Store complete JSON
// in ordered chunks inside the same transaction as the parent run and feedback.
export function writeNativeText(sql,id,kind,body) {
  table(sql);
  let part=0;
  for (let start=0;start<body.length;) {
    let end=Math.min(start+128*1024,body.length);
    if (end<body.length && /[\uD800-\uDBFF]/.test(body[end-1])) end--;
    sql.exec('INSERT INTO native_ltm_parts VALUES (?,?,?,?)',id,kind,part++,body.slice(start,end));
    start=end;
  }
}

export function readNativeText(sql,id,kind) {
  table(sql);
  const parts=sql.exec('SELECT body FROM native_ltm_parts WHERE run_id=? AND kind=? ORDER BY part',id,kind).toArray();
  return parts.length ? parts.map(row=>row.body).join('') : undefined;
}
