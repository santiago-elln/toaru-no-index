/**
 * seed.js — Indexa os arquivos HTML existentes em /pages para o Supabase.
 *
 * Suporta dois modos de autenticação — use o que preferir:
 *
 * MODO A — Secret API Key (recomendado para scripts de servidor):
 *   Gere uma Secret Key em: Supabase Dashboard → Project Settings → API → Secret keys
 *   Execute: node seed.js --secret=sb_secret_...
 *   Bypassa RLS diretamente, sem precisar de e-mail/senha.
 *
 * MODO B — Credenciais de usuário admin (sem chave extra):
 *   Execute: node seed.js --email=seu@email.com --password=suasenha
 *   Faz login como usuário autenticado; RLS permite operações de escrita.
 *
 * Instalação: npm install @supabase/supabase-js
 *
 * Para cada arquivo em /pages, o script irá:
 *   - Fazer upload do arquivo para o bucket "pages" no Storage
 *   - Inserir ou atualizar os metadados na tabela "pages"
 *
 * Edite o objeto METADATA abaixo para personalizar título, descrição, etc.
 */

const fs   = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// Lê variáveis do .env sem dependências externas
function loadEnv() {
  const envPath = path.join(__dirname, '.env')
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

const SUPABASE_URL  = env.VITE_SUPABASE_URL
const SUPABASE_ANON = env.VITE_SUPABASE_PUBLIC_KEY

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('❌  VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLIC_KEY não encontrados no .env')
  process.exit(1)
}

// ── Lê argumentos de linha de comando ───────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
)

const secretKey = args.secret
const email     = args.email
const password  = args.password

if (!secretKey && (!email || !password)) {
  console.error('❌  Use um dos modos abaixo:')
  console.error('    node seed.js --secret=sb_secret_...')
  console.error('    node seed.js --email=seu@email.com --password=suasenha')
  process.exit(1)
}

// Modo A: Secret Key bypassa RLS diretamente
// Modo B: chave anon + login de usuário autenticado
const SUPABASE_KEY = secretKey || SUPABASE_ANON
const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
})

const PAGES_DIR = path.join(__dirname, 'pages')

// ── Metadados manuais ───────────────────────────────────────────────────────
// Chave: nome do arquivo sem extensão (case-sensitive)
// Se um arquivo não estiver aqui, serão usados valores padrão.
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

async function seed() {
  // 1. Autenticação
  if (secretKey) {
    console.log('🔑  Usando Secret API Key — RLS bypassado.')
  } else {
    process.stdout.write(`🔐  Autenticando como ${email} … `)
    const { error: authErr } = await client.auth.signInWithPassword({ email, password })
    if (authErr) {
      console.log(`\n❌  Falha no login: ${authErr.message}`)
      process.exit(1)
    }
    console.log('✅')
  }

  // 2. Lista arquivos HTML em /pages
  const files = fs.readdirSync(PAGES_DIR).filter(f => /\.html?$/i.test(f))

  if (!files.length) {
    console.log('ℹ️  Nenhum arquivo HTML encontrado em /pages.')
    return
  }

  console.log(`\n📂  ${files.length} arquivo(s) encontrado(s) em /pages\n`)

  // 3. Faz upload e indexa cada arquivo
  for (const filename of files) {
    const nameWithoutExt = filename.replace(/\.html?$/i, '')
    const slug           = slugify(nameWithoutExt)
    const storagePath    = `${slug}.html`
    const filePath       = path.join(PAGES_DIR, filename)
    const fileBuffer     = fs.readFileSync(filePath)
    const fileSize       = fs.statSync(filePath).size

    const meta = METADATA[nameWithoutExt] || {
      title:       nameWithoutExt,
      description: null,
      category:    null,
      tags:        [],
    }

    process.stdout.write(`⬆️   ${filename} → ${storagePath} … `)

    // Upload para o Storage
    const { error: storErr } = await client.storage
      .from('pages')
      .upload(storagePath, fileBuffer, {
        upsert:      true,
        contentType: 'text/html; charset=utf-8',
      })

    if (storErr) {
      console.log(`❌  Storage: ${storErr.message}`)
      continue
    }

    // Inserir/atualizar metadados
    const { error: dbErr } = await client.from('pages').upsert({
      slug,
      title:        meta.title,
      description:  meta.description,
      category:     meta.category,
      tags:         meta.tags,
      storage_path: storagePath,
      file_size:    fileSize,
      published:    true,
    }, { onConflict: 'slug' })

    if (dbErr) {
      console.log(`❌  DB: ${dbErr.message}`)
    } else {
      console.log(`✅  OK  (slug: ${slug})`)
    }
  }

  console.log('\n🎉  Seed concluído!')
}

seed().catch(err => {
  console.error('Erro inesperado:', err)
  process.exit(1)
})
