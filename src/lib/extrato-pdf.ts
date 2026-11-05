import { cabecalho, rodape, entregar, nomeArquivo, AZUL, CINZA, FUNDO, type Escritorio } from './pdf-base'
import { qrPix } from './pix'
import { moeda, data, doc, comp, hojeIso } from './format'

export type ItemExtrato = { descricao: string; competencia: string; original: number; juros: number; pago: number; saldo: number }
export type DadosExtrato = { cliente: string; cnpj?: string | null; itens: ItemExtrato[]; titulo?: string }
export type ConfigPix = { chave: string; nome: string; cidade: string }

/**
 * Relação de honorários (débitos em aberto) do cliente, com QR Code Pix no valor exato do total em aberto.
 */
export async function gerarExtratoPdf(d: DadosExtrato, esc: Escritorio, pix: ConfigPix, abrir = true) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 18, W = 210 - 2 * L, R = 210 - L
  const total = Math.round(d.itens.reduce((s, i) => s + i.saldo, 0) * 100) / 100
  let y = await cabecalho(pdf, esc, d.titulo || 'RELAÇÃO DE HONORÁRIOS', `Posição em ${data(hojeIso())}`)

  // Cliente
  pdf.setFillColor(...FUNDO); pdf.roundedRect(L, y - 5, W, 14, 2, 2, 'F')
  pdf.setFontSize(8); pdf.setTextColor(...CINZA); pdf.setFont('helvetica', 'normal'); pdf.text('CLIENTE', L + 4, y)
  pdf.setFontSize(11); pdf.setTextColor(30); pdf.setFont('helvetica', 'bold')
  pdf.text(pdf.splitTextToSize(d.cliente, W - 60)[0], L + 4, y + 5.5)
  if (d.cnpj) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...CINZA)
    pdf.text(`${d.cnpj.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ'} ${doc(d.cnpj)}`, R - 4, y + 5.5, { align: 'right' })
  }
  y += 18

  // Tabela
  // posições: descrição/competência pela esquerda, valores alinhados pela direita
  const cols = { desc: L, comp: L + 84, orig: L + 124, pago: L + 152, saldo: R }  // valor = original + juros
  const cab = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...AZUL)
    pdf.text('DESCRIÇÃO', cols.desc, y); pdf.text('COMPET.', cols.comp, y)
    pdf.text('VALOR', cols.orig, y, { align: 'right' })
    pdf.text('PAGO', cols.pago, y, { align: 'right' }); pdf.text('SALDO', cols.saldo, y, { align: 'right' })
    y += 2; pdf.setDrawColor(...AZUL); pdf.line(L, y, R, y); y += 5
  }
  cab()
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(30)
  for (const [k, i] of d.itens.entries()) {
    if (y > 262) { pdf.addPage(); y = 20; cab(); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(30) }
    if (k % 2) { pdf.setFillColor(248, 250, 252); pdf.rect(L, y - 4, W, 6, 'F') }
    pdf.text(pdf.splitTextToSize(i.descricao, 80)[0], cols.desc, y)
    pdf.text(comp(i.competencia), cols.comp, y)
    pdf.text(moeda(i.original + i.juros), cols.orig, y, { align: 'right' })
    pdf.text(i.pago ? moeda(i.pago) : '—', cols.pago, y, { align: 'right' })
    pdf.text(moeda(i.saldo), cols.saldo, y, { align: 'right' })
    y += 6
  }
  pdf.setDrawColor(200); pdf.line(L, y - 3, R, y - 3)
  y += 4
  pdf.setFillColor(...AZUL); pdf.roundedRect(R - 80, y - 5.5, 80, 10, 1.5, 1.5, 'F')
  pdf.setTextColor(255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10)
  pdf.text('TOTAL EM ABERTO', R - 76, y + 1); pdf.setFontSize(12); pdf.text(moeda(total), R - 4, y + 1.2, { align: 'right' })
  y += 14

  // Quadro Pix (valor exato do total)
  if (total > 0 && pix.chave) {
    const altura = 62
    if (y + altura > 280) { pdf.addPage(); y = 24 }
    const { codigo, imagem } = await qrPix({ ...pix, valor: total }, 480)
    pdf.setDrawColor(...AZUL); pdf.setLineWidth(0.5); pdf.roundedRect(L, y, W, altura, 3, 3); pdf.setLineWidth(0.2)
    pdf.addImage(imagem, 'PNG', L + 5, y + 5, 52, 52)
    const x = L + 64
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...AZUL); pdf.text('PAGUE COM PIX', x, y + 11)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...CINZA)
    pdf.text('Aponte a câmera do app do seu banco para o QR Code.', x, y + 17)
    pdf.text('O valor já vem preenchido:', x, y + 22)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(30); pdf.text(moeda(total), x, y + 30)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...CINZA)
    pdf.text(`Chave Pix (CNPJ): ${pix.chave}`, x, y + 37)
    pdf.text(`Favorecido: ${esc.nome}`, x, y + 42)
    pdf.setFontSize(6.5); pdf.setTextColor(120)
    pdf.text('Pix Copia e Cola:', x, y + 48)
    pdf.setFont('courier', 'normal')
    pdf.text(pdf.splitTextToSize(codigo, R - x - 5), x, y + 51.5)
    y += altura + 6
  }

  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...CINZA)
  const aviso = pdf.splitTextToSize('Valores com juros calculados até a competência atual. Após o pagamento, se possível, envie o comprovante para facilitar a baixa. Caso já tenha efetuado o pagamento, desconsidere este aviso.', W)
  if (y + aviso.length * 4 > 282) { pdf.addPage(); y = 24 }
  pdf.text(aviso, L, y)

  rodape(pdf, `${esc.nome} · emitido pelo Siscon em ${data(hojeIso())}`)
  entregar(pdf, `Relacao_Honorarios_${nomeArquivo(d.cliente)}_${hojeIso()}.pdf`, abrir)
}
