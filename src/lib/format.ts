const moedaFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export const moeda = (v: number | null | undefined) => moedaFmt.format(Number(v || 0))

/** '2026-09-07' -> '07/09/2026' (sem passar por Date, evita erro de fuso) */
export const data = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** '2026-09-01' -> '09/2026' */
export const comp = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [a, m] = iso.split('-')
  return `${m}/${a}`
}

/** '09/2026' -> '2026-09-01' */
export const compParaIso = (mmaaaa: string) => {
  const [m, a] = mmaaaa.split('/')
  return `${a}-${m.padStart(2, '0')}-01`
}

export const hojeIso = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const doc = (v: string | null | undefined) => {
  const s = (v || '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return v || ''
}

/** Lista de competências MM/AAAA, da mais recente para a mais antiga */
export const ultimasCompetencias = (base: string, n = 24) => {
  const [m, a] = base.split('/').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const t = a * 12 + (m - 1) - i + 1
    return `${String((t % 12) + 1).padStart(2, '0')}/${Math.floor(t / 12)}`
  })
}

export const normaliza = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Vencimento útil: boleto que vence no sábado ou domingo pode ser pago na segunda sem atraso */
export const vencimentoUtil = (iso: string) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00')
  const dia = d.getDay()
  if (dia === 6) d.setDate(d.getDate() + 2); else if (dia === 0) d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('sv-SE')
}
/** Boleto em aberto está vencido só depois do vencimento útil (ignora o OVERDUE que o Asaas marca no fim de semana) */
export const boletoVencido = (vencimento: string, hoje = hojeIso()) => vencimentoUtil(vencimento) < hoje
