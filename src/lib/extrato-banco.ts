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

type Item = { x: number; y: number; s: string }

/** Itens de texto de cada página do PDF, com a posição (x da esquerda, y de baixo para cima) */
async function itensPdf(bytes: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist')
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const paginas: Item[][] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const conteudo = await (await doc.getPage(p)).getTextContent()
    paginas.push((conteudo.items as { str: string; transform: number[] }[]).filter(it => it.str?.trim())
      .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() })))
  }
  return paginas
}

/**
 * PDF do extrato do Sicoob (SISBR): colunas DATA | HISTÓRICO | VALOR. Cada lançamento começa numa data (DD/MM) e vai
 * até a próxima; o histórico ocupa várias linhas (ex.: "PIX RECEB.OUTRA IF / Recebimento Pix / NOME / CPF / DOC.: Pix")
 * e o valor termina em C (crédito) ou D (débito) — valores grandes quebram a linha ("3.350,00" / "C").
 */
export async function lerPdf(bytes: ArrayBuffer): Promise<Credito[]> {
  const paginas = await itensPdf(bytes)
  const tudo = paginas.flat().map(i => i.s).join(' ')
  const periodo = tudo.match(/(\d{2})\/(\d{2})\/(20\d{2})\s*-\s*(\d{2})\/(\d{2})\/(20\d{2})/)
  const anoDe = (mes: string) => periodo ? (periodo[3] !== periodo[6] && Number(mes) < Number(periodo[2]) ? periodo[6] : periodo[3])
    : (tudo.match(/\b\d{2}\/\d{2}\/(20\d{2})\b/) || [])[1] || String(new Date().getFullYear())
  const out: Credito[] = []
  let xValor = 0, xHist = 0
  for (const itens of paginas) {
    const cabV = itens.find(i => /^VALOR$/i.test(i.s)), cabH = itens.find(i => /^HIST[ÓO]RICO$/i.test(i.s))
    if (cabV) xValor = cabV.x
    if (cabH) xHist = cabH.x
    if (!xValor || !xHist) continue
    const limiteValor = xValor - 60   // o que fica à direita disso é a coluna VALOR
    const datas = itens.filter(i => i.x < xHist - 5 && /^\d{2}\/\d{2}$/.test(i.s)).sort((a, b) => b.y - a.y)
    datas.forEach((d, k) => {
      const prox = datas[k + 1]
      // faixa do lançamento: da linha da data (com folga para o valor alinhado um pouco acima) até a próxima data
      const dentro = (i: Item) => i.y <= d.y + 9 && (!prox || i.y > prox.y + 9)
      const val = itens.filter(i => i.x >= limiteValor && dentro(i)).sort((a, b) => b.y - a.y).map(i => i.s).join('')
      const m = val.match(/^(\d{1,3}(?:\.\d{3})*,\d{2})\*?([CD])/)
      if (!m || m[2] !== 'C') return
      const hist = itens.filter(i => i.x >= xHist - 5 && i.x < limiteValor && dentro(i)).sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s)
      if (/^SALDO/i.test(hist[0] || '')) return
      const [dd, mm] = d.s.split('/')
      const data = `${anoDe(mm)}-${mm}-${dd}`
      const historico = hist.filter(h => !/^DOC\.?:/i.test(h)).join(' · ')
      const doc = (hist.find(h => /^DOC\.?:/i.test(h)) || '').replace(/^DOC\.?:\s*/i, '')
      const valor = valorBr(m[1])
      out.push({ ref: `pdf:${data}:${valor.toFixed(2)}:${doc && doc !== 'Pix' ? doc : historico.slice(0, 80)}`, data, valor, historico })
    })
  }
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
