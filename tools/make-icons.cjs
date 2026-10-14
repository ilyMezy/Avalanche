// Generates the Avalanche application icons from the logo's vector geometry:
//   build/icon.svg  the master vector
//   build/icon.png  1024 px: the window icon in development, and the source electron-builder
//                   turns into the macOS .icns and the Linux icon set
//   build/icon.ico  16–256 px, used by electron-builder for the executable and the installer
//
// Run with:  npx electron tools/make-icons.cjs
// The generated files are committed, so this only needs running when the logo changes.
// The three paths below are the same geometry as src/renderer/src/components/Logo.tsx.

/* global require, Buffer, __dirname, setTimeout, console */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const BODY = 'M2.5 27.5 L9.6 14.6 L12.3 17.6 L17 4.5 L29.5 27.5 Z'
const SNOW = 'M17 4.5 L21.7 13.2 L19.3 12 L17.5 15 L15.4 12.5 L13.5 14.3 Z'
const SHADE = 'M17 4.5 L29.5 27.5 L18.6 27.5 L17.5 15 L19.3 12 L21.7 13.2 Z'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a6fb5"/>
      <stop offset="1" stop-color="#8fd0ff"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7.5" fill="url(#tile)"/>
  <g transform="translate(3.2 3.6) scale(0.8)">
    <path d="${BODY}" fill="#0a1424"/>
    <path d="${SHADE}" fill="#000" opacity="0.28"/>
    <path d="${SNOW}" fill="#ffffff"/>
  </g>
</svg>
`

/** An .ico file is a small directory followed by the images; PNG data is stored as-is. */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length
  images.forEach(({ size, png }, index) => {
    const at = index * 16
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, directory, ...images.map((image) => image.png)])
}

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, '..', 'build')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'icon.svg'), svg)

  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, frame: false, transparent: true, webPreferences: { offscreen: true } })
  // Drawn at the full 1024 px; the master's own 256 px size would fill only the top-left corner.
  const fullSize = svg.replace('width="256" height="256"', 'width="1024" height="1024"')
  const page = `<html><body style="margin:0;background:transparent;overflow:hidden">${fullSize}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const master = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' })
  const images = [256, 128, 64, 48, 32, 24, 16].map((size) => ({ size, png: master.resize({ width: size, height: size, quality: 'best' }).toPNG() }))

  fs.writeFileSync(path.join(outDir, 'icon.png'), master.toPNG())
  fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(images))
  console.log(`Wrote icon.svg, icon.png (1024 px), and icon.ico (${images.map((image) => image.size).join(', ')} px) to ${outDir}`)
  app.quit()
})
