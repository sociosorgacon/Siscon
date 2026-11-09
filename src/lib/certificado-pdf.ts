import { carregarLogo, entregar, nomeArquivo, AZUL, CINZA, FUNDO, type Escritorio } from './pdf-base'
import { qrPix, type DadosPix } from './pix'
import { moeda, doc } from './format'

/** Tipos de certificado digital cobrados à parte (cobrança avulsa: não é lançada no Siscon nem entra nos relatórios) */
export const CERTIFICADOS = [
  { id: 'A1 PJ', nome: 'Certificado Digital A1 PJ', valor: 160 },
  { id: 'A1 PF', nome: 'Certificado Digital A1 PF', valor: 115 },
] as const

/** Pix do certificado: valor exato e mensagem curta para aparecer no app do banco */
export const pixCertificado = (pix: Omit<DadosPix, 'valor'>, valor: number, tipo: string) =>
  qrPix({ ...pix, valor, txid: `CERT${tipo.replace(/\W/g, '')}`, mensagem: `Certificado ${tipo}` }, 480)

/**
 * Cobrança avulsa de certificado digital: uma folha simples, só com o necessário —
 * cliente, serviço, valor, QR Code Pix no valor exato e a chave Pix para digitar.
 */
export async function gerarCobrancaCertificadoPdf(d: { cliente: string; cnpj?: string | null; tipo: string; servico: string; valor: number },
  esc: Escritorio, pix: Omit<DadosPix, 'valor'>) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 25, R = 185, W = R - L, C = 105
  const chave = /^[\d./-]+$/.test(pix.chave) ? pix.chave.replace(/\D/g, '') : pix.chave

  // topo: faixa azul + logo
  pdf.setFillColor(...AZUL); pdf.rect(0, 0, 210, 5, 'F')
  const logo = await carregarLogo()
  if (logo) pdf.addImage(logo.url, 'PNG', C - 25, 12, 50, 50 * logo.h / logo.w)
  let y = 42
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...AZUL)
  pdf.text('CERTIFICADO DIGITAL', C, y, { align: 'center' }); y += 10

  // cliente + serviço + valor
  pdf.setFillColor(...FUNDO); pdf.roundedRect(L, y, W, 30, 2.5, 2.5, 'F')
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...CINZA)
  pdf.text('CLIENTE', L + 6, y + 7); pdf.text('VALOR', R - 6, y + 7, { align: 'right' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(30)
  pdf.text(pdf.splitTextToSize(d.cliente, W - 60)[0], L + 6, y + 13.5)
  pdf.setFontSize(20); pdf.setTextColor(...AZUL); pdf.text(moeda(d.valor), R - 6, y + 15, { align: 'right' })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...CINZA)
  const docTxt = d.cnpj && d.cnpj.replace(/\D/g, '').length >= 11 ? `${d.cnpj.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ'} ${doc(d.cnpj)}` : ''
  if (docTxt) pdf.text(docTxt, L + 6, y + 19.5)
  pdf.setTextColor(30); pdf.text(d.servico, L + 6, y + (docTxt ? 25.5 : 21))
  y += 40

  // QR Code Pix
  const { codigo, imagem } = await pixCertificado(pix, d.valor, d.tipo)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.setTextColor(...AZUL)
  pdf.text('PAGUE COM PIX', C, y, { align: 'center' }); y += 3
  pdf.addImage(imagem, 'PNG', C - 30, y, 60, 60); y += 66
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...CINZA)
  pdf.text('Aponte a câmera do app do seu banco para o QR Code. O valor já vem preenchido.', C, y, { align: 'center' }); y += 11

  // chave Pix para digitar
  pdf.setDrawColor(...AZUL); pdf.setLineWidth(0.5); pdf.roundedRect(L + 20, y - 6, W - 40, 19, 2.5, 2.5); pdf.setLineWidth(0.2)
  pdf.setFontSize(9); pdf.text('Não conseguiu ler o QR Code? Use a chave Pix (CNPJ):', C, y, { align: 'center' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(30); pdf.text(chave, C, y + 8, { align: 'center' })
  y += 19
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...CINZA)
  pdf.text(`Favorecido: ${esc.nome}`, C, y, { align: 'center' }); y += 9

  // copia e cola (pequeno)
  pdf.setFontSize(7); pdf.setTextColor(140); pdf.text('Pix Copia e Cola:', L, y); y += 3.5
  pdf.setFont('courier', 'normal'); pdf.text(pdf.splitTextToSize(codigo, W), L, y)

  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(150)
  pdf.text(`${esc.nome}${esc.telefone ? ` · ${esc.telefone}` : ''} · Após o pagamento, envie o comprovante.`, C, 285, { align: 'center' })
  entregar(pdf, `Certificado_${d.tipo.replace(/\W/g, '')}_${nomeArquivo(d.cliente)}.pdf`, true)
}
