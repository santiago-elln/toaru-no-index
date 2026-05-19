/**
 * dev-server.js — Servidor local para desenvolvimento.
 *
 * Uso: node dev-server.js
 * Acesse: http://localhost:3000
 *
 * - Serve index.html, page.html, admin.html e arquivos estáticos da raiz.
 * - Serve as páginas HTML de /pages diretamente (sem upload para o Supabase).
 * - Expõe /api/pages que escaneia /pages e devolve metadados no mesmo
 *   formato que o Supabase — index.html e page.html detectam o localhost
 *   e usam essa API ao invés de consultar o banco remoto.
 *
 * Sem dependências extras. Apenas Node.js built-in.
 */

const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT      = 3000
const ROOT      = __dirname
const PAGES_DIR = path.join(ROOT, 'pages')

// ── Lê .env e expõe valores para injetar nos HTMLs ──────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) return {}
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.split('=').map(s => s.trim()))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, v.join('=').replace(/^["']|["']$/g, '')])
  )
}

const env = loadEnv()
const SUPABASE_URL = env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLIC_KEY || ''

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️  VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLIC_KEY ausentes no .env — placeholders não serão substituídos.')
}

// ── Metadados manuais (mesmo objeto do seed.js) ─────────────────────────────
// Se um arquivo não estiver aqui, o título será o nome do arquivo.
const METADATA = {
  'TICKET 11 MAIO v3': {
    title:       'Relatório de Chamados — 11 Maio',
    description: 'Relatório detalhado de chamados de suporte técnico referente ao ticket de 11 de maio.',
    category:    'Ticket',
    tags:        ['suporte', 'chamados', 'maio'],
  },
  'ATA TICKET 11 MAIO': {
    title:       'Ata de Reunião — Ticket 11 Maio',
    description: 'Ata da reunião de alinhamento sobre melhoria de processos de ticket de 15/05/2026.',
    category:    'Ata',
    tags:        ['reunião', 'processos', 'melhoria'],
  },
}
// ───────────────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getLocalPages() {
  if (!fs.existsSync(PAGES_DIR)) return []

  return fs.readdirSync(PAGES_DIR)
    .filter(f => /\.html?$/i.test(f))
    .map(filename => {
      const nameWithoutExt = filename.replace(/\.html?$/i, '')
      const slug  = slugify(nameWithoutExt)
      const stat  = fs.statSync(path.join(PAGES_DIR, filename))
      const meta  = METADATA[nameWithoutExt] || {}

      return {
        id:           slug,
        slug,
        title:        meta.title       || nameWithoutExt,
        description:  meta.description || null,
        category:     meta.category    || null,
        tags:         meta.tags        || [],
        storage_path: filename,         // nome original — usado para montar a URL local
        file_size:    stat.size,
        published:    true,
        created_at:   stat.mtime.toISOString(),
        updated_at:   stat.mtime.toISOString(),
      }
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // ── CORS para facilitar fetch do frontend ──
  res.setHeader('Access-Control-Allow-Origin', '*')

  // ── API local que imita o Supabase ──────────────────────────────────────
  if (url.pathname === '/api/pages') {
    const slug  = url.searchParams.get('slug')
    const pages = getLocalPages()
    const result = slug ? pages.find(p => p.slug === slug) : pages

    if (slug && !result) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
    return
  }

  // ── Arquivos estáticos ───────────────────────────────────────────────────
  let reqPath = url.pathname === '/' ? '/index.html' : url.pathname

  // Segurança: impede path traversal fora da raiz
  const filePath = path.normalize(path.join(ROOT, reqPath))
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    res.end('Forbidden')
    return
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found: ' + reqPath)
    return
  }

  const ext  = path.extname(filePath).toLowerCase()
  const mime = MIME_TYPES[ext] || 'application/octet-stream'

  // Injeta variáveis de ambiente nos HTMLs (substitui placeholders do build)
  if (ext === '.html') {
    let content = fs.readFileSync(filePath, 'utf8')
    content = content
      .replace(/__SUPABASE_URL__/g, SUPABASE_URL)
      .replace(/__SUPABASE_KEY__/g, SUPABASE_KEY)
    res.writeHead(200, { 'Content-Type': mime })
    res.end(content)
    return
  }

  res.writeHead(200, { 'Content-Type': mime })
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  const divider = '─'.repeat(48)
  console.log(`\n${divider}`)
  console.log(`  🚀  Dev server: http://localhost:${PORT}`)
  console.log(`  📂  Páginas:    ${PAGES_DIR}`)
  console.log(`  📡  API local:  http://localhost:${PORT}/api/pages`)
  console.log(`${divider}\n`)

  const pages = getLocalPages()
  if (pages.length) {
    console.log(`  Páginas encontradas (${pages.length}):`)
    pages.forEach(p => console.log(`   · ${p.title}  →  /pages/${p.storage_path}`))
  } else {
    console.log('  ⚠️  Nenhum arquivo HTML encontrado em /pages')
  }
  console.log()
})
