import type { Recibo } from './supabase'
import { moeda, data, doc, comp } from './format'

export type Escritorio = { nome: string; cnpj: string; endereco: string; cidade: string; telefone: string }

const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

function ate999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const c = Math.floor(n / 100), r = n % 100, partes: string[] = []
  if (c) partes.push(centenas[c])
  if (r < 20) { if (r) partes.push(unidades[r]) }
  else { partes.push(dezenas[Math.floor(r / 10)] + (r % 10 ? ' e ' + unidades[r % 10] : '')) }
  return partes.join(' e ')
}

/** 1234.56 -> "mil, duzentos e trinta e quatro reais e cinquenta e seis centavos" */
export function porExtenso(valor: number): string {
  const inteiro = Math.floor(Math.round(valor * 100) / 100), cent = Math.round((valor - inteiro) * 100)
  const milhoes = Math.floor(inteiro / 1e6), milhares = Math.floor((inteiro % 1e6) / 1000), resto = inteiro % 1000
  const grupos: string[] = []
  if (milhoes) grupos.push(milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`)
  if (milhares) grupos.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`)
  if (resto) grupos.push(ate999(resto))
  const ultimo = resto || milhares
  let txt = grupos.length > 1 && (ultimo < 100 || ultimo % 100 === 0)
    ? grupos.slice(0, -1).join(' ') + ' e ' + grupos.at(-1) : grupos.join(' ')
  if (inteiro) txt += milhoes && !milhares && !resto ? ' de reais' : inteiro === 1 ? ' real' : ' reais'
  if (cent) txt += (inteiro ? ' e ' : '') + ate999(cent) + (cent === 1 ? ' centavo' : ' centavos')
  return txt || 'zero real'
}

export async function gerarReciboPdf(r: Recibo, esc: Escritorio, abrir = true) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 18, W = 210 - 2 * L
  let y = 20

  // Cabeçalho do escritório
  pdf.setFillColor(15, 61, 62); pdf.rect(0, 0, 210, 6, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(15, 61, 62)
  pdf.text(esc.nome, L, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(90)
  const linhaEsc = [esc.cnpj && `CNPJ ${esc.cnpj}`, esc.endereco, esc.telefone].filter(Boolean).join('   |   ')
  if (linhaEsc) pdf.text(linhaEsc, L, y + 5)

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(30)
  pdf.text('RECIBO', 210 - L, y, { align: 'right' })
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal')
  pdf.text(r.numero ? `Nº ${String(r.numero).padStart(5, '0')}` : 'Sem número', 210 - L, y + 6, { align: 'right' })

  y += 14
  pdf.setDrawColor(220); pdf.line(L, y, 210 - L, y)

  // Valor em destaque
  y += 10
  pdf.setFillColor(238, 246, 245); pdf.roundedRect(L, y - 6, W, 14, 2, 2, 'F')
  pdf.setFontSize(9); pdf.setTextColor(90); pdf.text('VALOR RECEBIDO', L + 4, y)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(15, 61, 62)
  pdf.text(moeda(r.valor), 210 - L - 4, y + 3, { align: 'right' })

  // Texto do recibo
  y += 18
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.setTextColor(30)
  const pagador = `${r.cliente_nome}${r.cliente_cnpj ? `, ${(r.cliente_cnpj.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ')} ${doc(r.cliente_cnpj)}` : ''}`
  const texto = `Recebemos de ${pagador}, a importância de ${moeda(r.valor)} (${porExtenso(r.valor)}), referente aos itens abaixo discriminados, pelo que damos plena e geral quitação.`
  const linhas = pdf.splitTextToSize(texto, W)
  pdf.text(linhas, L, y); y += linhas.length * 5.2 + 6

  // Itens
  pdf.setFontSize(8.5); pdf.setTextColor(110); pdf.setFont('helvetica', 'bold')
  pdf.text('DESCRIÇÃO', L, y); pdf.text('COMPETÊNCIA', L + W - 62, y); pdf.text('VALOR', 210 - L, y, { align: 'right' })
  y += 2; pdf.setDrawColor(200); pdf.line(L, y, 210 - L, y); y += 5
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(30)
  for (const it of r.recibo_itens || []) {
    const desc = pdf.splitTextToSize(`${it.descricao}${it.desconto ? ` (desconto ${moeda(it.desconto)})` : ''}`, W - 70)
    pdf.text(desc, L, y)
    pdf.text(it.competencia ? comp(it.competencia) : '—', L + W - 62, y)
    pdf.text(moeda(it.valor), 210 - L, y, { align: 'right' })
    y += desc.length * 5 + 2
    if (y > 250) { pdf.addPage(); y = 20 }
  }
  pdf.line(L, y - 1, 210 - L, y - 1); y += 5
  pdf.setFont('helvetica', 'bold'); pdf.text('TOTAL', L, y); pdf.text(moeda(r.valor), 210 - L, y, { align: 'right' })

  y += 10
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(80)
  if (r.metodo_pagamento) { pdf.text(`Forma de pagamento: ${r.metodo_pagamento}`, L, y); y += 5 }
  if (r.observacao) { const o = pdf.splitTextToSize(`Observação: ${r.observacao}`, W); pdf.text(o, L, y); y += o.length * 5 }

  // Local, data e assinatura
  y = Math.max(y + 18, 215)
  const [a, m, d] = r.data_pagamento.split('-')
  const mesNome = new Date(Number(a), Number(m) - 1, 1).toLocaleString('pt-BR', { month: 'long' })
  pdf.setFontSize(10.5); pdf.setTextColor(30)
  pdf.text(`${esc.cidade || 'Iúna/ES'}, ${Number(d)} de ${mesNome} de ${a}.`, 210 - L, y, { align: 'right' })
  y += 24
  pdf.setDrawColor(120); pdf.line(105 - 40, y, 105 + 40, y)
  pdf.setFontSize(9.5); pdf.text(esc.nome, 105, y + 5, { align: 'center' })

  if (r.cancelado) {
    pdf.setTextColor(220, 38, 38); pdf.setFontSize(48); pdf.setFont('helvetica', 'bold')
    pdf.text('CANCELADO', 105, 150, { align: 'center', angle: 30 })
  }

  pdf.setFontSize(7.5); pdf.setTextColor(150); pdf.setFont('helvetica', 'normal')
  pdf.text(`Emitido pelo Siscon em ${data(new Date().toISOString())}`, L, 287)

  const nome = `Recibo_${r.numero ? String(r.numero).padStart(5, '0') : 'sn'}_${r.cliente_nome.replace(/[^\w]+/g, '_').slice(0, 40)}.pdf`
  if (abrir) window.open(pdf.output('bloburl'), '_blank')
  else pdf.save(nome)
}

/** Busca o recibo com os itens e abre o PDF */
export async function imprimirRecibo(id: string, esc: Escritorio, abrir = true) {
  const { supabase, ok } = await import('./supabase')
  const r = ok(await supabase.from('recibos').select('*, recibo_itens(*)').eq('id', id).single()) as Recibo
  await gerarReciboPdf(r, esc, abrir)
}
