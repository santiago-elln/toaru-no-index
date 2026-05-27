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
const LIVE_DIR  = path.join(ROOT, 'live')
const GREEN_DIR = path.join(ROOT, 'green')

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
const SUPABASE_URL = env.VITE_SUPABASE_URL        || ''
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLIC_KEY  || ''

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️  VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLIC_KEY ausentes no .env — placeholders não serão substituídos.')
}

// ── Metadados manuais (mesmo objeto do seed.js) ─────────────────────────────
// Metadados para arquivos em /pages (apresentações).
const METADATA = {
  'Dashboard MAY 13th FEELINGS': {
    title:        'Dashboard de Sentimentos — 13 Maio',
    description:  'Análise de sentimento e percepção dos atendimentos realizados em 13 de maio.',
    category:     'Relatório',
    tags:         ['sentimentos', 'atendimento', 'maio'],
    analyst_only: true,
  },
  'TICKET 11 MAIO v3': {
    title:        'Relatório de Chamados — 11 Maio',
    description:  'Relatório detalhado de chamados de suporte técnico referente ao ticket de 11 de maio.',
    category:     'Ticket',
    tags:         ['suporte', 'chamados', 'maio'],
    analyst_only: true,
  },
  'ÁUDIOS DE ATENDIMENTO': {
    title:        'Relatório de Áudios de Atendimento',
    description:  'Análise de IA dos áudios enviados em atendimento e comparativos de TMA.',
    category:     'Análise',
    tags:         ['processos', 'melhoria'],
    analyst_only: true,
  },
}

// Metadados para dashboards em /live e /green.
const DASHBOARD_METADATA = {
  'performance': {
    slug:            'suporte-performance',
    title:           'Suporte Performance',
    description:     'Respostas, conversões e qualidade das campanhas de disparo em tempo real.',
    analyst_only:    true,
    show_in_sidebar: false,
  },
  'biblioteca-de-audios': {
    slug:            'biblioteca-de-audios',
    title:           'Biblioteca de Áudios',
    description:     'Acervo de gravações de atendimento para consulta e análise.',
    analyst_only:    false,
    show_in_sidebar: false,
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
  const results = []

  // ── /pages (apresentações — visíveis na sidebar) ──────────────────────────
  if (fs.existsSync(PAGES_DIR)) {
    fs.readdirSync(PAGES_DIR)
      .filter(f => /\.html?$/i.test(f))
      .forEach(filename => {
        const nameWithoutExt = filename.replace(/\.html?$/i, '')
        const slug = slugify(nameWithoutExt)
        const stat = fs.statSync(path.join(PAGES_DIR, filename))
        const meta = METADATA[nameWithoutExt] || {}
        results.push({
          id:              slug,
          slug,
          title:           meta.title        || nameWithoutExt,
          description:     meta.description  || null,
          category:        meta.category     || null,
          tags:            meta.tags         || [],
          analyst_only:    meta.analyst_only || false,
          show_in_sidebar: true,
          storage_path:    filename,
          file_size:       stat.size,
          published:       true,
          created_at:      stat.mtime.toISOString(),
          updated_at:      stat.mtime.toISOString(),
        })
      })
  }

  // ── /live e /green (dashboards — não aparecem na sidebar) ─────────────────
  for (const [dir, prefix] of [[LIVE_DIR, 'live'], [GREEN_DIR, 'green']]) {
    if (!fs.existsSync(dir)) continue
    fs.readdirSync(dir)
      .filter(f => /\.html?$/i.test(f))
      .forEach(filename => {
        const nameWithoutExt = filename.replace(/\.html?$/i, '')
        const meta = DASHBOARD_METADATA[nameWithoutExt] || {}
        const slug = meta.slug || slugify(nameWithoutExt)
        const stat = fs.statSync(path.join(dir, filename))
        results.push({
          id:              slug,
          slug,
          title:           meta.title        || nameWithoutExt,
          description:     meta.description  || null,
          category:        null,
          tags:            [],
          analyst_only:    meta.analyst_only || false,
          show_in_sidebar: false,
          storage_path:    null,
          file_size:       stat.size,
          published:       true,
          created_at:      stat.mtime.toISOString(),
          updated_at:      stat.mtime.toISOString(),
        })
      })
  }

  return results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
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

  // Decodifica %C3%81 → Á etc. para que nomes com acentos/espaços sejam encontrados no disco
  try { reqPath = decodeURIComponent(reqPath) } catch { /* mantém original se inválido */ }

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
      .replace(/__SUPABASE_URL__/g,  SUPABASE_URL)
      .replace(/__SUPABASE_KEY__/g,  SUPABASE_KEY)
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
