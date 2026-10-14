import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/errors'
import { validateName } from '@shared/domain/naming'
import type { CompileIssue, CompileResult, LatexFile, LatexProject, SaveResult, TexToolchain, TextDocument } from '@shared/types'
import { hashOf, readIfExists, safeWriteFile } from '../infrastructure/fs/safe-write'
import type { AppContext } from './context'
import type { WorkspaceService } from './workspace'

export const MANIFEST_NAME = '.owproject.json'
const BUILD_DIR = 'output'
const EDITABLE = new Set(['.tex', '.bib', '.cls', '.sty', '.bst', '.txt', '.md'])
const PASS_TIMEOUT_MS = 120_000
const MAX_PASSES = 4

interface Manifest {
  entryFile: string
  engine: string
}

function escapeLatex(text: string): string {
  return text.replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}')
}

function template(kind: 'article' | 'report', title: string): string {
  const body =
    kind === 'report'
      ? `\\chapter{Introduction}

Write your report here.

\\section{Background}

A numbered equation:
\\begin{equation}
  \\int_0^1 x^2 \\, dx = \\frac{1}{3}
\\end{equation}
`
      : `\\begin{abstract}
A short summary of the paper.
\\end{abstract}

\\section{Introduction}

Write your paper here. Inline mathematics such as $E = mc^2$ and a numbered equation:
\\begin{equation}
  \\int_0^1 x^2 \\, dx = \\frac{1}{3}
\\end{equation}
`
  return `\\documentclass[11pt,a4paper]{${kind}}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${escapeLatex(title)}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

${body}
% To cite sources, add entries to references.bib, cite them with \\cite{key},
% and uncomment the two lines below.
% \\bibliographystyle{plain}
% \\bibliography{references}

\\end{document}
`
}

const SAMPLE_BIB = `% Bibliography entries for this project.
@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}
`

/** Creates the files of a new LaTeX project inside an existing, empty directory. */
export async function createLatexProjectFiles(dir: string, title: string, kind: 'article' | 'report'): Promise<void> {
  const manifest: Manifest = { entryFile: 'main.tex', engine: 'pdflatex' }
  await fsp.writeFile(path.join(dir, 'main.tex'), template(kind, title), { flag: 'wx' })
  await fsp.writeFile(path.join(dir, 'references.bib'), SAMPLE_BIB, { flag: 'wx' })
  await fsp.writeFile(path.join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), { flag: 'wx' })
}

const MISSING_FILE_HINT =
  ' — this file is not part of the installed TeX distribution. Nothing was downloaded; install the package through your TeX distribution, or add its files to the project folder.'

/** Extracts errors and warnings from a TeX log produced with `-file-line-error`. */
export function parseLatexLog(log: string): CompileIssue[] {
  const issues: CompileIssue[] = []
  const seen = new Set<string>()
  const push = (issue: CompileIssue): void => {
    const key = `${issue.severity}|${issue.file}|${issue.line}|${issue.message}`
    if (seen.has(key) || issues.length >= 100) return
    seen.add(key)
    issues.push(issue)
  }
  for (const rawLine of log.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const located = /^(?:\.\/)?([^\s:()]+\.[A-Za-z]+):(\d+): (.+)$/.exec(line)
    if (located) {
      let message = located[3]
      if (/File [`'].+?' not found/.test(message)) message += MISSING_FILE_HINT
      push({ severity: 'error', file: located[1].replace(/\\/g, '/'), line: Number(located[2]), message })
      continue
    }
    const bang = /^! (.+)$/.exec(line)
    if (bang && !/Emergency stop|Fatal error/.test(bang[1])) {
      push({ severity: 'error', file: null, line: null, message: bang[1] })
      continue
    }
    const warning = /^(?:LaTeX|Package \S+|Class \S+) Warning: (.+?)(?: on input line (\d+))?\.?$/.exec(line)
    if (warning) {
      push({ severity: 'warning', file: null, line: warning[2] ? Number(warning[2]) : null, message: warning[1] })
    }
  }
  return issues
}

interface RunResult {
  code: number | null
  output: string
  timedOut: boolean
}

function run(command: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    // No shell is involved: arguments are passed as an array and shell escape is disabled in TeX.
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, PASS_TIMEOUT_MS)
    const collect = (chunk: Buffer): void => {
      if (output.length < 2_000_000) output += chunk.toString('latin1')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, output: `${output}\n${error.message}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output, timedOut })
    })
  })
}

export class LatexService {
  private toolchainCache: TexToolchain | null = null
  private readonly running = new Set<string>()

  constructor(
    private readonly ctx: AppContext,
    private readonly workspace: WorkspaceService
  ) {}

  /** Looks for an installed TeX distribution. Nothing is installed or downloaded. */
  async toolchain(refresh = false): Promise<TexToolchain> {
    if (this.toolchainCache && !refresh) return this.toolchainCache
    const exe = process.platform === 'win32' ? 'pdflatex.exe' : 'pdflatex'
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA
      if (local) dirs.push(path.join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'))
      dirs.push('C:\\Program Files\\MiKTeX\\miktex\\bin\\x64')
    } else if (process.platform === 'darwin') {
      // MacTeX's commands live here, and apps started from the Dock do not get it on their PATH.
      dirs.push('/Library/TeX/texbin', '/usr/local/bin', '/opt/homebrew/bin')
    } else {
      // A TeX Live installed by hand goes under /usr/local/texlive/<year>; distribution packages use /usr/bin.
      const root = '/usr/local/texlive'
      const years = fs.existsSync(root) ? fs.readdirSync(root).filter((name) => /^\d{4}$/.test(name)).sort().reverse() : []
      for (const year of years) dirs.push(path.join(root, year, 'bin', process.arch === 'arm64' ? 'aarch64-linux' : 'x86_64-linux'))
      dirs.push('/usr/bin', '/usr/local/bin')
    }
    const enginePath = dirs.map((dir) => path.join(dir, exe)).find((candidate) => fs.existsSync(candidate)) ?? null
    if (!enginePath) {
      this.toolchainCache = { available: false, distribution: null, version: null, enginePath: null }
      return this.toolchainCache
    }
    const version = await new Promise<string | null>((resolve) => {
      execFile(enginePath, ['--version'], { timeout: 20_000, windowsHide: true }, (error, stdout) => {
        resolve(error ? null : (stdout.split(/\r?\n/)[0]?.trim() ?? null))
      })
    })
    this.toolchainCache = {
      available: version !== null,
      distribution: version === null ? null : /miktex/i.test(version) ? 'MiKTeX' : /tex live/i.test(version) ? 'TeX Live' : 'unknown',
      version,
      enginePath
    }
    return this.toolchainCache
  }

  private projectDir(id: string): string {
    const entry = this.workspace.getRequired(id)
    if (entry.kind !== 'latex_project') throw new AppError('INVALID_INPUT', 'This item is not a LaTeX project.')
    return this.workspace.absOf(entry.relPath)
  }

  private async manifest(dir: string): Promise<Manifest> {
    const raw = await readIfExists(path.join(dir, MANIFEST_NAME))
    try {
      const parsed = raw ? (JSON.parse(raw.toString('utf8')) as Partial<Manifest>) : {}
      const entryFile = typeof parsed.entryFile === 'string' && !parsed.entryFile.includes('..') ? parsed.entryFile : 'main.tex'
      return { entryFile, engine: 'pdflatex' }
    } catch {
      return { entryFile: 'main.tex', engine: 'pdflatex' }
    }
  }

  /** Resolves a project-relative file path, refusing anything that would leave the project. */
  private fileAbs(dir: string, file: string): string {
    const segments = file.split('/')
    if (segments.length === 0 || segments.some((segment) => validateName(segment) !== null)) {
      throw new AppError('INVALID_INPUT', 'That file name is not allowed.')
    }
    const abs = path.join(dir, ...segments)
    const relative = path.relative(dir, abs)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError('OUTSIDE_WORKSPACE', 'That path is outside the project.')
    }
    return abs
  }

  async project(id: string): Promise<LatexProject> {
    const dir = this.projectDir(id)
    const manifest = await this.manifest(dir)
    const files: LatexFile[] = []
    const walk = async (relative: string): Promise<void> => {
      const items = await fsp.readdir(path.join(dir, relative), { withFileTypes: true })
      items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      for (const item of items) {
        if (item.name.startsWith('.')) continue
        const relPath = relative ? `${relative}/${item.name}` : item.name
        if (item.isDirectory()) {
          if (relPath === BUILD_DIR) continue
          files.push({ relPath, isDirectory: true, editable: false })
          await walk(relPath)
        } else {
          files.push({ relPath, isDirectory: false, editable: EDITABLE.has(path.extname(item.name).toLowerCase()) })
        }
      }
    }
    await walk('')
    return { entryFile: manifest.entryFile, engine: manifest.engine, files, hasPdf: fs.existsSync(this.pdfPath(dir, manifest)) }
  }

  private pdfPath(dir: string, manifest: Manifest): string {
    return path.join(dir, BUILD_DIR, `${path.basename(manifest.entryFile, '.tex')}.pdf`)
  }

  async readFile(id: string, file: string): Promise<TextDocument> {
    const abs = this.fileAbs(this.projectDir(id), file)
    if (!EDITABLE.has(path.extname(abs).toLowerCase())) throw new AppError('INVALID_INPUT', 'This file type cannot be edited here.')
    const data = await readIfExists(abs)
    if (!data) throw new AppError('NOT_FOUND', 'The file no longer exists.')
    return { content: data.toString('utf8'), version: hashOf(data) }
  }

  async writeFile(id: string, file: string, content: string, baseVersion: string, force: boolean): Promise<SaveResult> {
    const abs = this.fileAbs(this.projectDir(id), file)
    if (!EDITABLE.has(path.extname(abs).toLowerCase())) throw new AppError('INVALID_INPUT', 'This file type cannot be edited here.')
    const current = await readIfExists(abs)
    if (!force && (!current || hashOf(current) !== baseVersion)) {
      throw new AppError('CONFLICT', 'The file was changed on disk by another program.')
    }
    const data = Buffer.from(content, 'utf8')
    await safeWriteFile(abs, data)
    await this.workspace.reindex(id)
    return { version: hashOf(data), modifiedAt: this.ctx.now() }
  }

  async createFile(id: string, file: string): Promise<void> {
    const dir = this.projectDir(id)
    const abs = this.fileAbs(dir, file)
    if (!EDITABLE.has(path.extname(abs).toLowerCase())) {
      throw new AppError('INVALID_INPUT', 'Use one of these extensions: .tex, .bib, .cls, .sty, .bst, .txt, .md')
    }
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    try {
      await fsp.writeFile(abs, '', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('CONFLICT', 'A file with that name already exists.')
      throw error
    }
  }

  async deleteFile(id: string, file: string): Promise<void> {
    const dir = this.projectDir(id)
    const manifest = await this.manifest(dir)
    if (file === manifest.entryFile) throw new AppError('INVALID_INPUT', 'The main file of a project cannot be deleted.')
    const abs = this.fileAbs(dir, file)
    if (!fs.existsSync(abs)) throw new AppError('NOT_FOUND', 'The file no longer exists.')
    await this.ctx.trash(abs)
    await this.workspace.reindex(id)
  }

  async readPdf(id: string): Promise<Uint8Array | null> {
    const dir = this.projectDir(id)
    const data = await readIfExists(this.pdfPath(dir, await this.manifest(dir)))
    return data ? new Uint8Array(data) : null
  }

  /**
   * Compiles the project with the locally installed engine. Shell escape is disabled, and
   * MiKTeX's on-demand package installer is switched off so nothing is ever downloaded.
   * The result reports exactly what ran: `passes: 0` means no compiler was executed.
   */
  async compile(id: string): Promise<CompileResult> {
    const started = Date.now()
    const empty = { passes: 0, durationMs: 0, issues: [], log: '', pdfUpdated: false }
    const dir = this.projectDir(id)
    const tool = await this.toolchain()
    if (!tool.available || !tool.enginePath) return { status: 'no-compiler', ...empty }
    if (this.running.has(id)) return { status: 'busy', ...empty }

    this.running.add(id)
    try {
      const manifest = await this.manifest(dir)
      const stem = path.basename(manifest.entryFile, '.tex')
      const buildDir = path.join(dir, BUILD_DIR)
      await fsp.mkdir(buildDir, { recursive: true })
      // \include writes auxiliary files into matching subfolders of the build directory.
      const project = await this.project(id)
      for (const file of project.files) {
        if (file.isDirectory) await fsp.mkdir(path.join(buildDir, file.relPath), { recursive: true })
      }

      const pdfPath = this.pdfPath(dir, manifest)
      const pdfBefore = fs.existsSync(pdfPath) ? fs.statSync(pdfPath).mtimeMs : 0
      const args = [
        '-interaction=nonstopmode',
        '-file-line-error',
        '-no-shell-escape',
        '-synctex=1',
        `-output-directory=${BUILD_DIR}`,
        ...(tool.distribution === 'MiKTeX' ? ['-disable-installer'] : []),
        manifest.entryFile
      ]
      const readBuildFile = async (ext: string): Promise<string> =>
        (await readIfExists(path.join(buildDir, `${stem}.${ext}`)))?.toString('latin1') ?? ''

      let passes = 0
      let last: RunResult = { code: -1, output: '', timedOut: false }
      let bibliographyRan = false
      let log = ''
      while (passes < MAX_PASSES) {
        last = await run(tool.enginePath, args, dir)
        passes++
        log = (await readBuildFile('log')) || last.output
        if (last.timedOut || last.code !== 0) break
        if (!bibliographyRan) {
          const aux = await readBuildFile('aux')
          if (/\\citation\{/.test(aux) && /\\bibdata\{/.test(aux)) {
            const bibtex = path.join(path.dirname(tool.enginePath), process.platform === 'win32' ? 'bibtex.exe' : 'bibtex')
            if (fs.existsSync(bibtex)) await run(bibtex, [`${BUILD_DIR}/${stem}`], dir)
            bibliographyRan = true
            continue
          }
        }
        const needsRerun = /Rerun to get|Label\(s\) may have changed|Rerun LaTeX/.test(log)
        if (!needsRerun && !(bibliographyRan && passes < 3)) break
      }

      const pdfAfter = fs.existsSync(pdfPath) ? fs.statSync(pdfPath).mtimeMs : 0
      const pdfUpdated = pdfAfter > pdfBefore
      const issues = parseLatexLog(log)
      const status: CompileResult['status'] = last.timedOut
        ? 'timeout'
        : last.code === 0 && pdfAfter > 0 && pdfUpdated
          ? 'success'
          : 'failed'
      if (status === 'failed' && !issues.some((issue) => issue.severity === 'error')) {
        issues.unshift({ severity: 'error', file: null, line: null, message: `The TeX engine exited with code ${last.code}. See the raw log for details.` })
      }
      return { status, passes, durationMs: Date.now() - started, issues, log: log.slice(-200_000), pdfUpdated }
    } finally {
      this.running.delete(id)
    }
  }
}
