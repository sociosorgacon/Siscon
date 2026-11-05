import type { Honorario, Despesa } from './supabase'
import { moeda, data, hojeIso } from './format'
import { AZUL, CINZA, FUNDO, cabecalho, rodape, entregar, type Escritorio } from './pdf-base'

type GrupoPdf = { cliente: string; cnpj: string; hon: Honorario[]; des: Despesa[]; totHon: number; totDes: number; total: number }

const mmaa = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(2, 4)}`
const n2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const docFmt = (d: string) => { const n = (d || '').replace(/\D/g, ''); return n.length === 14 ? n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : n.length === 11 ? n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d }

/**
 * Relatório de débitos em aberto, compacto para imprimir: UMA linha por cliente
 * (nome + CPF/CNPJ | débitos em aberto em texto corrido | total), sem Pix, WhatsApp, observações nem colunas vazias.
 * Valor de cada item = saldo em aberto (honorário já com juros).
 */
export async function gerarRelatorioDebitosPdf(d: { titulo: string; subtitulo: string; grupos: GrupoPdf[] }, esc: Escritorio) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 12, R = 198
  const col = { cli: L, itens: L + 62, hon: R - 38, des: R - 19, total: R }   // totalizador por empresa: honorários | despesas | total
  const largCli = 59, largItens = col.hon - 20 - col.itens
  let y = await cabecalho(pdf, esc, d.titulo, d.subtitulo) - 4

  const cab = () => {
    pdf.setFillColor(...AZUL); pdf.rect(L, y - 3.6, R - L, 5.2, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(255)
    pdf.text('CLIENTE', col.cli + 1.5, y); pdf.text('DÉBITOS EM ABERTO', col.itens, y)
    pdf.text('HONOR.', col.hon - 1, y, { align: 'right' }); pdf.text('DESP.', col.des - 1, y, { align: 'right' })
    pdf.text('TOTAL', col.total - 1.5, y, { align: 'right' })
    y += 4.6
  }
  cab()

  let totHon = 0, totDes = 0
  d.grupos.forEach((g, k) => {
    const itens = [
      ...g.hon.map(h => { totHon += h.saldo; return `Hon. ${mmaa(h.competencia)} ${n2(h.saldo)}` }),
      ...g.des.map(x => { totDes += x.saldo; return `${x.descricao} (${mmaa(x.competencia)}) ${n2(x.saldo)}` }),
    ].join('  ·  ')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5)
    const linhasItens: string[] = pdf.splitTextToSize(itens, largItens)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5)
    const nome: string = pdf.splitTextToSize(g.cliente, largCli)[0]
    const alt = Math.max(2, linhasItens.length) * 3.3 + 1.2
    if (y + alt > 280) { pdf.addPage(); y = 14; cab() }
    if (k % 2) { pdf.setFillColor(...FUNDO); pdf.rect(L, y - 3.1, R - L, alt, 'F') }
    pdf.setTextColor(30); pdf.text(nome, col.cli + 1.5, y)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(...CINZA)
    if (g.cnpj) pdf.text(docFmt(g.cnpj), col.cli + 1.5, y + 3.2)
    pdf.setFontSize(7.5); pdf.setTextColor(50)
    linhasItens.forEach((t, i) => pdf.text(t, col.itens, y + i * 3.3))
    pdf.text(g.totHon ? n2(g.totHon) : '—', col.hon - 1, y, { align: 'right' })
    pdf.text(g.totDes ? n2(g.totDes) : '—', col.des - 1, y, { align: 'right' })
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(30)
    pdf.text(n2(g.total), col.total - 1.5, y, { align: 'right' })
    y += alt
  })

  // Totais
  if (y + 16 > 280) { pdf.addPage(); y = 16 }
  y += 2
  pdf.setDrawColor(...AZUL); pdf.setLineWidth(0.4); pdf.line(L, y - 3, R, y - 3); pdf.setLineWidth(0.2)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...CINZA)
  pdf.text(`${d.grupos.length} cliente(s)  ·  Honorários ${moeda(totHon)}  ·  Despesas extras ${moeda(totDes)}`, L, y + 1.5)
  pdf.setFillColor(...AZUL); pdf.roundedRect(R - 70, y - 2.5, 70, 8, 1.2, 1.2, 'F')
  pdf.setTextColor(255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9)
  pdf.text('TOTAL EM ABERTO', R - 67, y + 2.6); pdf.setFontSize(10.5); pdf.text(moeda(totHon + totDes), R - 3, y + 2.7, { align: 'right' })

  rodape(pdf, `${esc.nome} · emitido em ${data(hojeIso())} · valores em aberto, honorários com juros até a competência atual`)
  entregar(pdf, `Relatorio_debitos_${hojeIso()}.pdf`, true)
}
