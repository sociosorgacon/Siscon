import type { jsPDF } from 'jspdf'

/** Cores da marca em RGB */
export const AZUL: [number, number, number] = [32, 72, 121]
export const CINZA: [number, number, number] = [115, 118, 123]
export const FUNDO: [number, number, number] = [238, 243, 249]

let logoCache: Promise<{ url: string; w: number; h: number } | null> | null = null

/** Carrega /logo.png uma única vez, como data URL, com as proporções */
export function carregarLogo() {
  logoCache ??= (async () => {
    try {
      const blob = await (await fetch('/logo.png')).blob()
      const url = await new Promise<string>((ok, erro) => {
        const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = erro; r.readAsDataURL(blob)
      })
      const { w, h } = await new Promise<{ w: number; h: number }>(ok => {
        const img = new Image(); img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => ok({ w: 500, h: 184 }); img.src = url
      })
      return { url, w, h }
    } catch { return null }
  })()
  return logoCache
}

export type Escritorio = { nome: string; cnpj: string; endereco: string; cidade: string; telefone: string }

/**
 * Cabeçalho padrão: faixa azul, logo à esquerda, título e número à direita, linha com dados do escritório.
 * Retorna o y onde o conteúdo começa.
 */
export async function cabecalho(pdf: jsPDF, esc: Escritorio, titulo: string, subtitulo?: string) {
  const L = 18
  pdf.setFillColor(...AZUL); pdf.rect(0, 0, 210, 5, 'F')
  const logo = await carregarLogo()
  if (logo) {
    const largura = 58
    pdf.addImage(logo.url, 'PNG', L, 11, largura, largura * logo.h / logo.w)
  } else {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...AZUL); pdf.text(esc.nome, L, 22)
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor(...AZUL)
  pdf.text(titulo, 210 - L, 19, { align: 'right' })
  if (subtitulo) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...CINZA); pdf.text(subtitulo, 210 - L, 25, { align: 'right' }) }

  pdf.setFontSize(8); pdf.setTextColor(...CINZA); pdf.setFont('helvetica', 'normal')
  const linha = [esc.cnpj && `CNPJ ${esc.cnpj}`, [esc.endereco, esc.cidade].filter(Boolean).join(' - '), esc.telefone].filter(Boolean).join('   |   ')
  if (linha) pdf.text(linha, L, 38)
  pdf.setDrawColor(...AZUL); pdf.setLineWidth(0.4); pdf.line(L, 41, 210 - L, 41); pdf.setLineWidth(0.2)
  return 50
}

export function rodape(pdf: jsPDF, texto: string) {
  const n = pdf.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i)
    pdf.setFontSize(7.5); pdf.setTextColor(160); pdf.setFont('helvetica', 'normal')
    pdf.text(texto, 18, 289)
    if (n > 1) pdf.text(`Página ${i} de ${n}`, 192, 289, { align: 'right' })
  }
}

export function entregar(pdf: jsPDF, nome: string, abrir: boolean) {
  if (abrir) window.open(pdf.output('bloburl'), '_blank')
  else pdf.save(nome)
}

export const nomeArquivo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
