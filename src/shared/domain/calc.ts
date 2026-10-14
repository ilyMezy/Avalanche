// Arithmetic typed into a document: "12*(3+4)=" followed by a space becomes "12*(3+4)=84".
// The expression is read by a small parser written for the purpose; nothing is ever passed to
// `eval` or `Function`, so text in a document cannot run code.

const FUNCTIONS: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil
}
const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E }
const MAX_LENGTH = 200

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'op'; value: string }

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === ' ' || char === ' ') {
      i++
    } else if (/[\d.]/.test(char)) {
      // Thousands separators inside a number ("1,250.5") are accepted and ignored.
      const match = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(source.slice(i))
      if (!match || match[0] === '') return null
      const value = Number(match[0].replace(/,/g, ''))
      if (!Number.isFinite(value)) return null
      tokens.push({ kind: 'number', value })
      i += match[0].length
    } else if (/[a-zπ]/i.test(char)) {
      const match = /^[a-zπ]+/i.exec(source.slice(i))!
      tokens.push({ kind: 'name', value: match[0].toLowerCase() })
      i += match[0].length
    } else if ('+-*/^%()×÷−·'.includes(char)) {
      tokens.push({ kind: 'op', value: char === '×' || char === '·' ? '*' : char === '÷' ? '/' : char === '−' ? '-' : char })
      i++
    } else {
      return null
    }
  }
  return tokens
}

/** The value of an arithmetic expression, or null when it is not one (or does not have a finite value). */
export function evaluate(source: string): number | null {
  if (source.length > MAX_LENGTH) return null
  const tokens = tokenize(source)
  if (!tokens || tokens.length === 0) return null
  let at = 0
  let depth = 0
  const peek = (): Token | undefined => tokens[at]
  const isOp = (value: string): boolean => peek()?.kind === 'op' && peek()!.value === value

  // expression := term (('+' | '-') term)*
  const expression = (): number => {
    let value = term()
    while (isOp('+') || isOp('-')) {
      const op = tokens[at++].value
      const right = term()
      value = op === '+' ? value + right : value - right
    }
    return value
  }
  // term := factor (('*' | '/' | '%') factor)*
  const term = (): number => {
    let value = factor()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[at++].value
      // A trailing "%" after a number is a percentage ("50%"), not a remainder.
      if (op === '%' && (peek() === undefined || (peek()!.kind === 'op' && peek()!.value !== '(' && peek()!.value !== '-'))) {
        value = value / 100
        continue
      }
      const right = factor()
      value = op === '*' ? value * right : op === '/' ? value / right : value % right
    }
    return value
  }
  // factor := ('-' | '+') factor | power
  const factor = (): number => {
    if (isOp('-')) {
      at++
      return -factor()
    }
    if (isOp('+')) {
      at++
      return factor()
    }
    return power()
  }
  // power := primary ('^' factor)?   (right-associative)
  const power = (): number => {
    const base = primary()
    if (isOp('^')) {
      at++
      return Math.pow(base, factor())
    }
    return base
  }
  const primary = (): number => {
    const token = tokens[at++]
    if (!token) throw new Error('end')
    if (token.kind === 'number') return token.value
    if (token.kind === 'op' && token.value === '(') {
      if (++depth > 50) throw new Error('depth')
      const value = expression()
      if (!isOp(')')) throw new Error('paren')
      at++
      depth--
      return value
    }
    if (token.kind === 'name') {
      if (token.value in FUNCTIONS) {
        if (!isOp('(')) throw new Error('call')
        // The argument is the bracketed expression that follows the name.
        return FUNCTIONS[token.value](primary())
      }
      if (token.value in CONSTANTS) return CONSTANTS[token.value]
    }
    throw new Error('unexpected')
  }
  try {
    const value = expression()
    if (at !== tokens.length || !Number.isFinite(value)) return null
    return value
  } catch {
    return null
  }
}

/** A result as it is written into the document: at most ten significant digits, no float noise. */
export function formatResult(value: number): string {
  if (Object.is(value, -0)) return '0'
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value)
  const rounded = Number(value.toPrecision(10))
  return Math.abs(rounded) >= 1e15 || (Math.abs(rounded) < 1e-6 && rounded !== 0) ? rounded.toExponential(6).replace(/\.?0+e/, 'e') : String(rounded)
}

// The expression is the longest run of arithmetic at the end of the text before the "=".
const TAIL = /(?:^|[^\w.)%])((?:[\d.(πa-z+\-−][\d\s.,+\-−*/^%()×÷·πa-z]*)?[\d.)%πa-z])\s*=$/i

/**
 * Given the text before the cursor, ending in "=", returns the result to append, or null.
 * Only a real calculation is answered: there must be an operator or a function, so "x = " or
 * "Total 2024 =" stay as typed.
 */
export function autoResult(textBeforeCursor: string): string | null {
  if (!textBeforeCursor.endsWith('=')) return null
  const line = textBeforeCursor.slice(Math.max(0, textBeforeCursor.length - MAX_LENGTH - 1))
  const match = TAIL.exec(line)
  if (!match) return null
  // Words before the sum ("apples 2+3=") are trimmed off until what remains is an expression.
  let candidate = match[1].trim()
  for (;;) {
    const hasOperation = /[+\-−*/^%×÷·]/.test(candidate.replace(/^[-−+]/, '')) || /[a-z]+\s*\(/i.test(candidate)
    if (hasOperation && /\d|π|pi|\be\b/i.test(candidate)) {
      const value = evaluate(candidate)
      if (value !== null) return formatResult(value)
    }
    const cut = candidate.search(/\s/)
    if (cut === -1) return null
    candidate = candidate.slice(cut + 1).trim()
    if (!candidate) return null
  }
}
