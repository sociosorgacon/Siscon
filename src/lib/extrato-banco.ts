/**
 * Leitura do extrato bancário (Sicoob) em OFX ou PDF: devolve os CRÉDITOS com data, valor e histórico.
 * Usado para achar os pagamentos de certificado digital (valores 115,00 e 160,00).
 */
export type Credito = { ref: string; data: string; valor: number; historico: string }

const valorBr = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

/** OFX: cada <STMTTRN> com TRNAMT positivo é um crédito; FITID identifica o lançamento */
export function lerOfx(texto: string): Credito[] {
  const tag = (bloco: string, t: string) => (bloco.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'))?.[1] || '').trim()
  const out: Credito[] = []
  for (const m of texto.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>)/gi)) {
    const b = m[1]
    const valor = Number(tag(b, 'TRNAMT').replace(',', '.'))
    const dt = tag(b, 'DTPOSTED')
    if (!(valor > 0) || !/^\d{8}/.test(dt)) continue
    const data = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`
    const historico = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' · ')
    out.push({ ref: `ofx:${tag(b, 'FITID') || `${data}:${valor}:${historico}`}`, data, valor: Math.round(valor * 100) / 100, historico })
  }
  return out
}

/** Texto do PDF, linha a linha (junta os pedaços com a mesma altura na página) */
async function linhasPdf(bytes: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const linhas: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const conteudo = await (await doc.getPage(p)).getTextContent()
    const porY = new Map<number, { x: number; s: string }[]>()
    for (const it of conteudo.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue
      const y = Math.round(it.transform[5] / 2) * 2
      porY.set(y, [...(porY.get(y) || []), { x: it.transform[4], s: it.str }])
    }
    ;[...porY.entries()].sort((a, b) => b[0] - a[0])
      .forEach(([, l]) => linhas.push(l.sort((a, b) => a.x - b.x).map(x => x.s).join(' ').replace(/\s+/g, ' ').trim()))
  }
  return linhas
}

/**
 * PDF do Sicoob: linha com data (DD/MM ou DD/MM/AAAA) e valor terminado em "C" (crédito; "D" = débito).
 * O nome de quem pagou costuma vir na própria linha ou nas 1–2 linhas seguintes (sem data): entram no histórico.
 */
export async function lerPdf(bytes: ArrayBuffer): Promise<Credito[]> {
  const linhas = await linhasPdf(bytes)
  const ano = (linhas.join(' ').match(/\b\d{2}\/\d{2}\/(20\d{2})\b/) || [])[1] || String(new Date().getFullYear())
  const out: Credito[] = []
  let ultimaData = ''
  linhas.forEach((l, i) => {
    const d = l.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?\b/)
    if (d) ultimaData = `${d[3] || ano}-${d[2]}-${d[1]}`
    // valor com C/D colado ou separado (ex.: "160,00C", "160,00 C", "+160,00")
    const v = [...l.matchAll(/([+-]?)\s?(\d{1,3}(?:\.\d{3})*,\d{2})\s?([CD])?(?![\d,])/g)]
    if (!v.length || !ultimaData) return
    const [, sinal, num, cd] = v[0]
    const credito = cd === 'C' || (!cd && sinal === '+')
    if (!credito) return
    // histórico: o texto da linha sem data/valores + as linhas seguintes que não começam com data nem têm valor
    const resto = [l]
    for (let k = i + 1; k <= i + 2 && k < linhas.length; k++) {
      if (/^\d{2}\/\d{2}/.test(linhas[k]) || /\d,\d{2}\s?[CD]?\b/.test(linhas[k])) break
      resto.push(linhas[k])
    }
    const historico = resto.join(' ').replace(/^\d{2}\/\d{2}(\/\d{4})?/, '').replace(/[+-]?\s?\d{1,3}(?:\.\d{3})*,\d{2}\s?[CD]?/g, '').replace(/\s+/g, ' ').trim()
    const valor = valorBr(num)
    out.push({ ref: `pdf:${ultimaData}:${valor.toFixed(2)}:${historico.slice(0, 60)}`, data: ultimaData, valor, historico })
  })
  // mesmo dia, valor e histórico repetidos: numera para não confundir as referências
  const vistos = new Map<string, number>()
  return out.map(c => { const n = (vistos.get(c.ref) || 0) + 1; vistos.set(c.ref, n); return n > 1 ? { ...c, ref: `${c.ref}#${n}` } : c })
}

export async function lerExtrato(arquivo: File): Promise<Credito[]> {
  if (/\.pdf$/i.test(arquivo.name) || arquivo.type === 'application/pdf') return lerPdf(await arquivo.arrayBuffer())
  // OFX do Sicoob costuma vir em latin1
  const bytes = await arquivo.arrayBuffer()
  let texto = new TextDecoder('utf-8').decode(bytes)
  if (texto.includes('�')) texto = new TextDecoder('latin1').decode(bytes)
  if (!/<STMTTRN>/i.test(texto)) throw new Error('Arquivo não reconhecido. Envie o extrato do Sicoob em OFX ou PDF.')
  return lerOfx(texto)
}

/** Pontuação de semelhança entre o nome do cliente e o histórico do extrato (palavras em comum) */
export function semelhanca(nome: string, historico: string) {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  const ignora = new Set(['LTDA', 'EIRELI', 'ME', 'EPP', 'SA', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'CIA', 'COMERCIO', 'SERVICOS'])
  const palavras = n(nome).split(/[^A-Z0-9]+/).filter(p => p.length >= 3 && !ignora.has(p))
  const h = ' ' + n(historico).replace(/[^A-Z0-9]+/g, ' ') + ' '
  return palavras.filter(p => h.includes(` ${p} `)).length
}
