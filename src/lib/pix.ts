/**
 * Pix "copia e cola" (BR Code / EMV, padrão do Banco Central) com valor definido.
 * O QR é estático: o valor vem preenchido, mas o pagamento não é identificado automaticamente
 * (a baixa continua manual ou via Asaas).
 */

const campo = (id: string, valor: string) => id + String(valor.length).padStart(2, '0') + valor

/** Remove acentos e caracteres fora do padrão; corta no tamanho máximo */
const limpa = (s: string, max: number) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max)

export function crc16(payload: string) {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export type DadosPix = { chave: string; nome: string; cidade: string; valor?: number; txid?: string; mensagem?: string }

export function pixCopiaECola({ chave, nome, cidade, valor, txid, mensagem }: DadosPix) {
  const chaveLimpa = /^[\d./-]+$/.test(chave) ? chave.replace(/\D/g, '') : chave.trim()
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chaveLimpa) + (mensagem ? campo('02', limpa(mensagem, 40)) : '')
  const id = (txid || '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***'
  const p = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986')
    + (valor && valor > 0 ? campo('54', valor.toFixed(2)) : '')
    + campo('58', 'BR') + campo('59', limpa(nome, 25)) + campo('60', limpa(cidade, 15))
    + campo('62', campo('05', id)) + '6304'
  return p + crc16(p)
}

/** QR Code em PNG (data URL) */
export async function qrPix(dados: DadosPix, tamanho = 320) {
  const QR = await import('qrcode')
  const codigo = pixCopiaECola(dados)
  const imagem = await QR.toDataURL(codigo, { width: tamanho, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1a1a1a', light: '#ffffff' } })
  return { codigo, imagem }
}
