type V = number | string | boolean;

export class Sheet {
  private cells = new Map<string, V | null>();
  private cache = new Map<string, V>();

  set(addr: string, v: V | null) {
    this.cells.set(addr.replace(/\$/g, ""), v);
    this.cache.clear();
  }

  get(addr: string): V {
    const a = addr.replace(/\$/g, "");
    if (this.cache.has(a)) return this.cache.get(a)!;
    const raw = this.cells.get(a);
    let v: V;
    if (raw === undefined || raw === null) v = "";
    else if (typeof raw === "string" && raw.startsWith("=")) v = new Parser(raw.slice(1), this).parse();
    else v = raw;
    this.cache.set(a, v);
    return v;
  }

  range(ref: string): V[] {
    const [a, b] = ref.replace(/\$/g, "").split(":");
    const [c1, r1] = split(a);
    const [c2, r2] = split(b);
    const out: V[] = [];
    for (let c = colNum(c1); c <= colNum(c2); c++) for (let r = r1; r <= r2; r++) out.push(this.get(`${colName(c)}${r}`));
    return out;
  }
}

const split = (a: string): [string, number] => {
  const m = /^([A-Z]+)(\d+)$/.exec(a)!;
  return [m[1], Number(m[2])];
};
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const num = (v: V) => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : v === "" ? 0 : Number(v));

class Parser {
  private i = 0;
  constructor(private s: string, private sheet: Sheet) {}

  parse(): V {
    const v = this.compare();
    if (this.i < this.s.length) throw new Error(`Unexpected "${this.s.slice(this.i)}"`);
    return v;
  }

  private ws() {
    while (this.s[this.i] === " ") this.i++;
  }

  private compare(): V {
    const left = this.add();
    this.ws();
    const m = /^(>=|<=|<>|=|>|<)/.exec(this.s.slice(this.i));
    if (!m) return left;
    this.i += m[1].length;
    const right = this.add();
    const l = typeof left === "string" || typeof right === "string" ? String(left) : num(left);
    const r = typeof left === "string" || typeof right === "string" ? String(right) : num(right);
    switch (m[1]) {
      case "=": return l === r;
      case "<>": return l !== r;
      case ">": return l > r;
      case "<": return l < r;
      case ">=": return l >= r;
      default: return l <= r;
    }
  }

  private add(): V {
    let v = this.mul();
    for (;;) {
      this.ws();
      const ch = this.s[this.i];
      if (ch !== "+" && ch !== "-") return v;
      this.i++;
      const r = this.mul();
      v = ch === "+" ? num(v) + num(r) : num(v) - num(r);
    }
  }

  private mul(): V {
    let v = this.unary();
    for (;;) {
      this.ws();
      const ch = this.s[this.i];
      if (ch !== "*" && ch !== "/") return v;
      this.i++;
      const r = this.unary();
      v = ch === "*" ? num(v) * num(r) : num(v) / num(r);
    }
  }

  private unary(): V {
    this.ws();
    if (this.s[this.i] === "-") {
      this.i++;
      return -num(this.unary());
    }
    return this.atom();
  }

  private atom(): V {
    this.ws();
    const rest = this.s.slice(this.i);
    let m: RegExpExecArray | null;
    if (rest[0] === "(") {
      this.i++;
      const v = this.compare();
      this.expect(")");
      return v;
    }
    if (rest[0] === '"') {
      const end = this.s.indexOf('"', this.i + 1);
      const v = this.s.slice(this.i + 1, end);
      this.i = end + 1;
      return v;
    }
    if ((m = /^\d+(\.\d+)?/.exec(rest))) {
      this.i += m[0].length;
      return Number(m[0]);
    }
    if ((m = /^([A-Z]+)\(/.exec(rest))) {
      this.i += m[0].length;
      return this.call(m[1]);
    }
    if ((m = /^\$?[A-Z]+\$?\d+/.exec(rest))) {
      this.i += m[0].length;
      return this.sheet.get(m[0]);
    }
    throw new Error(`Cannot parse "${rest}"`);
  }

  private expect(ch: string) {
    this.ws();
    if (this.s[this.i] !== ch) throw new Error(`Expected ${ch} at "${this.s.slice(this.i)}"`);
    this.i++;
  }

  private rangeArg(): string {
    this.ws();
    const m = /^\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+/.exec(this.s.slice(this.i));
    if (!m) throw new Error("Expected a range");
    this.i += m[0].length;
    return m[0];
  }

  private call(fn: string): V {
    const args = () => {
      this.ws();
      if (this.s[this.i] === ",") this.i++;
    };
    let v: V;
    switch (fn) {
      case "SUM": {
        v = this.sheet.range(this.rangeArg()).reduce<number>((a, x) => a + (typeof x === "number" ? x : 0), 0);
        break;
      }
      case "SUMIF": {
        const crit = this.sheet.range(this.rangeArg());
        args();
        const want = this.compare();
        args();
        const vals = this.sheet.range(this.rangeArg());
        v = crit.reduce<number>((a, c, i) => a + (String(c) === String(want) && typeof vals[i] === "number" ? (vals[i] as number) : 0), 0);
        break;
      }
      case "COUNTIF": {
        const r = this.sheet.range(this.rangeArg());
        args();
        const want = this.compare();
        v = r.filter((c) => String(c) === String(want)).length;
        break;
      }
      case "IF": {
        const c = this.compare();
        args();
        const a = this.compare();
        args();
        const b = this.compare();
        v = c ? a : b;
        break;
      }
      case "ROUND": {
        const x = num(this.compare());
        args();
        const d = num(this.compare());
        const f = 10 ** d;
        v = Math.sign(x) * Math.round(Math.abs(x) * f) / f;
        break;
      }
      default:
        throw new Error(`Unsupported function ${fn}`);
    }
    this.expect(")");
    return v;
  }
}
