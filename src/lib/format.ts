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

// ---------- Feriados (vencimento de boletos) ----------
/** Feriados nacionais fixos (valor inicial da lista em Configurações) */
export const FERIADOS_PADRAO = ['01/01 Confraternização Universal', '21/04 Tiradentes', '01/05 Dia do Trabalho', '07/09 Independência',
  '12/10 Nossa Senhora Aparecida', '02/11 Finados', '15/11 Proclamação da República', '20/11 Consciência Negra', '25/12 Natal']
export type Feriado = { dia: string; nome: string; municipio?: string }   // dia = 'MM-DD' (todo ano) ou 'AAAA-MM-DD'; municipio vazio = vale para todos
/** Lê a lista de Configurações: uma por linha, "DD/MM Nome" (todo ano) ou "DD/MM/AAAA Nome" (só naquele ano);
 *  com " | Município" no fim vale só para os clientes daquele município (feriado municipal) */
export function lerFeriados(texto: string): Feriado[] {
  return (texto || '').split('\n').map(l => l.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*[-–]?\s*(.*)$/)).filter(Boolean).map(m => {
    const [, d, mm, a, resto] = m as RegExpMatchArray
    const [nome, municipio] = resto.split('|').map(x => x.trim())
    const md = `${mm.padStart(2, '0')}-${d.padStart(2, '0')}`
    return { dia: a ? `${a}-${md}` : md, nome, municipio: municipio || undefined }
  })
}
/** Compara municípios sem acento, maiúsculas, "/UF" nem espaços extras (ex.: "IUNA" = "Iúna" = "Iúna/ES") */
export const mesmoMunicipio = (a?: string | null, b?: string | null) => {
  const n = (s?: string | null) => (s || '').split('/')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return !!n(a) && n(a) === n(b)
}
const isoDe = (d: Date) => d.toLocaleDateString('sv-SE')
/** Domingo de Páscoa (algoritmo de Meeus) */
function pascoa(a: number) {
  const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3)
  const i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451)
  const mes = Math.floor((i + m - 7 * n + 114) / 31), dia = ((i + m - 7 * n + 114) % 31) + 1
  return new Date(a, mes - 1, dia, 12)
}
/** Feriados móveis em que os bancos não abrem, calculados sozinhos: Carnaval (seg e ter), Sexta-feira Santa e Corpus Christi */
export function feriadosMoveis(ano: number): Feriado[] {
  const p = pascoa(ano), mais = (n: number) => { const d = new Date(p); d.setDate(d.getDate() + n); return isoDe(d) }
  return [{ dia: mais(-48), nome: 'Carnaval (segunda)' }, { dia: mais(-47), nome: 'Carnaval (terça)' },
    { dia: mais(-2), nome: 'Sexta-feira Santa' }, { dia: mais(60), nome: 'Corpus Christi' }]
}
let feriadosCadastrados: Feriado[] = lerFeriados(FERIADOS_PADRAO.join('\n'))
/** Chamado ao carregar as Configurações */
export const definirFeriados = (texto: string) => { feriadosCadastrados = lerFeriados(texto) }
/** Feriado no dia: os gerais valem para todos; os municipais só para o cliente daquele município */
export const ehFeriado = (iso: string, municipio?: string | null) => {
  const ano = Number(iso.slice(0, 4))
  return feriadosCadastrados.some(f => (f.dia === iso || f.dia === iso.slice(5)) && (!f.municipio || mesmoMunicipio(f.municipio, municipio)))
    || feriadosMoveis(ano).some(f => f.dia === iso)
}

/** Vencimento útil: boleto que vence no sábado, domingo ou feriado pode ser pago no próximo dia útil sem atraso */
export const vencimentoUtil = (iso: string, municipio?: string | null) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00')
  for (let i = 0; i < 10 && (d.getDay() === 0 || d.getDay() === 6 || ehFeriado(isoDe(d), municipio)); i++) d.setDate(d.getDate() + 1)
  return isoDe(d)
}
/** Boleto em aberto está vencido só depois do vencimento útil (ignora o OVERDUE que o Asaas marca no fim de semana/feriado) */
export const boletoVencido = (vencimento: string, hoje = hojeIso(), municipio?: string | null) => vencimentoUtil(vencimento, municipio) < hoje
