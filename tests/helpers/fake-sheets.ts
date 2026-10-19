import { Sheet } from "./formula";

type Cell = string | number | null;
const COL = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const NAME = (n: number) => {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export class FakeTab {
  cells = new Map<string, Cell>();
  merges: string[] = [];
  hiddenCols = new Set<number>();
  formatRequests = 0;
  rowCount = 1000;
  columnCount = 26;
  constructor(public sheetId: number, public title: string) {}

  evaluate(addr: string) {
    const s = new Sheet();
    for (const [k, v] of this.cells) s.set(k, v);
    const v = s.get(addr);
    return v === "" ? null : v;
  }
}

export type Fault = { status: number; match?: RegExp; times: number; retryAfter?: string };

export class FakeSheets {
  tabs: FakeTab[] = [];
  faults: Fault[] = [];
  batchCalls = 0;
  private next = 0;

  addTab(title: string) {
    const t = new FakeTab(this.next++, title);
    this.tabs.push(t);
    return t;
  }

  tab(title: string) {
    return this.tabs.find((t) => t.title === title)!;
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const fault = this.faults.find((f) => f.times > 0 && (!f.match || f.match.test(url.toString())));
    if (fault) {
      fault.times--;
      return this.json(fault.status, { error: { message: "injected", status: "UNAVAILABLE" } }, fault.retryAfter ? { "retry-after": fault.retryAfter } : {});
    }
    if (method === "GET" && url.pathname.endsWith("/values:batchGet")) return this.batchGet(url.searchParams.getAll("ranges"));
    if (method === "GET") {
      return this.json(200, {
        properties: { title: "Family sheet" },
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/x/edit",
        sheets: this.tabs.map((t) => ({ properties: { sheetId: t.sheetId, title: t.title, gridProperties: { rowCount: t.rowCount, columnCount: t.columnCount } } })),
      });
    }
    if (method === "POST" && url.pathname.endsWith(":batchUpdate")) {
      this.batchCalls++;
      const replies = (body.requests as Record<string, unknown>[]).map((r) => this.apply(r));
      return this.json(200, { replies });
    }
    return this.json(404, { error: { message: "not found" } });
  };

  private json(status: number, data: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
  }

  private byId(id: number) {
    const t = this.tabs.find((x) => x.sheetId === id);
    if (!t) throw new Error(`no sheet ${id}`);
    return t;
  }

  private apply(r: Record<string, unknown>): unknown {
    const [kind, req] = Object.entries(r)[0] as [string, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (kind) {
      case "addSheet": {
        const t = this.addTab(req.properties.title);
        return { addSheet: { properties: { sheetId: t.sheetId, title: t.title, gridProperties: { rowCount: 1000, columnCount: 26 } } } };
      }
      case "updateCells": {
        if (req.range) {
          const t = this.byId(req.range.sheetId);
          const { startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 } = req.range;
          for (const k of [...t.cells.keys()]) {
            const m = /^([A-Z]+)(\d+)$/.exec(k)!;
            const c = COL(m[1]) - 1;
            const row = Number(m[2]) - 1;
            if (row >= r0 && row < r1 && c >= c0 && c < c1) t.cells.delete(k);
          }
          return {};
        }
        const t = this.byId(req.start.sheetId);
        (req.rows as { values: { userEnteredValue?: Record<string, unknown> }[] }[]).forEach((row, i) =>
          row.values.forEach((v, j) => {
            const key = `${NAME(req.start.columnIndex + j + 1)}${req.start.rowIndex + i + 1}`;
            const u = v.userEnteredValue;
            if (!u) t.cells.delete(key);
            else t.cells.set(key, (u.formulaValue ?? u.numberValue ?? u.stringValue) as Cell);
          }),
        );
        return {};
      }
      case "mergeCells": {
        const g = req.range;
        this.byId(g.sheetId).merges.push(`${NAME(g.startColumnIndex + 1)}${g.startRowIndex + 1}:${NAME(g.endColumnIndex)}${g.endRowIndex}`);
        return {};
      }
      case "unmergeCells":
        this.byId(req.range.sheetId).merges = [];
        return {};
      case "updateDimensionProperties": {
        const t = this.byId(req.range.sheetId);
        t.formatRequests++;
        if (req.range.dimension === "COLUMNS" && "hiddenByUser" in req.properties) {
          for (let i = req.range.startIndex; i < req.range.endIndex; i++) {
            if (req.properties.hiddenByUser) t.hiddenCols.add(i);
            else t.hiddenCols.delete(i);
          }
        }
        return {};
      }
      case "appendDimension": {
        const t = this.byId(req.sheetId);
        if (req.dimension === "ROWS") t.rowCount += req.length;
        else t.columnCount += req.length;
        return {};
      }
      case "repeatCell":
      case "updateBorders":
        this.byId(req.range.sheetId).formatRequests++;
        return {};
      default:
        throw new Error(`fake does not support ${kind}`);
    }
  }

  private batchGet(ranges: string[]) {
    const valueRanges = ranges.map((range) => {
      const m = /^'((?:[^']|'')+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range)!;
      const t = this.tab(m[1].replace(/''/g, "'"));
      const c0 = COL(m[2]);
      const r0 = Number(m[3]);
      const c1 = COL(m[4] ?? m[2]);
      const r1 = Number(m[5] ?? m[3]);
      let maxR = 0;
      let maxC = 0;
      for (const k of t.cells.keys()) {
        const mm = /^([A-Z]+)(\d+)$/.exec(k)!;
        const c = COL(mm[1]);
        const r = Number(mm[2]);
        if (c >= c0 && c <= c1 && r >= r0 && r <= r1) {
          maxR = Math.max(maxR, r);
          maxC = Math.max(maxC, c);
        }
      }
      const values: unknown[][] = [];
      for (let r = r0; r <= maxR; r++) {
        const row: unknown[] = [];
        for (let c = c0; c <= maxC; c++) row.push(t.cells.has(`${NAME(c)}${r}`) ? (t.evaluate(`${NAME(c)}${r}`) ?? "") : "");
        while (row.length && row[row.length - 1] === "") row.pop();
        values.push(row);
      }
      return { range, values };
    });
    return this.json(200, { valueRanges });
  }
}
