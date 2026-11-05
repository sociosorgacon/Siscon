import { useState } from 'react'
import { useApp } from '../lib/app'
import { chamarAsaas, abrirBoleto } from '../lib/asaas'
import { moeda, data } from '../lib/format'
import { Botao, Cartao, LogoAsaas, Vazio, useAviso } from '../components/ui'
import { Icone } from '../components/icones'

/**
 * Boletos do mês por GRUPO do Asaas (definido no cadastro do cliente no Asaas):
 * • Impressos  → um PDF único, em ordem alfabética, para imprimir de uma vez;
 * • Acessórias → ZIP com um PDF por cliente, nome "NOME - Boleto MM-AAAA.pdf" (para o envio pelo Acessórias).
 * Entram os boletos PENDENTES com vencimento no mês escolhido.
 */
type BoletoLote = { id: string; nome: string; cpfCnpj: string; valor: number; vencimento: string; boleto: string }
const GRUPOS = [
  { grupo: 'Impressos', titulo: 'Impressos', saida: 'PDF único para imprimir', cor: 'from-blue-600 to-blue-500' },
  { grupo: 'Acessórias', titulo: 'Acessórias', saida: 'ZIP com um PDF por cliente', cor: 'from-emerald-600 to-emerald-500' },
] as const

const mesSeguinte = (mmaaaa: string) => { const [m, a] = mmaaaa.split('/').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}` }
const nomeArq = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** Baixa os PDFs pela função (4 por vez), avisando o progresso */
async function baixarPdfs(lista: BoletoLote[], progresso: (n: number) => void) {
  const out: { b: BoletoLote; bytes: Uint8Array }[] = []
  const erros: string[] = []
  let feitos = 0
  const fila = [...lista]
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let b = fila.shift(); b; b = fila.shift()) {
      try { const r = await chamarAsaas<{ base64: string }>('pdf', { url: b.boleto }); out.push({ b, bytes: b64(r.base64) }) }
      catch (e) { erros.push(`${b.nome}: ${(e as Error).message}`) }
      progresso(++feitos)
    }
  }))
  out.sort((x, y) => x.b.nome.localeCompare(y.b.nome, 'pt-BR'))
  return { out, erros }
}

function salvar(blob: Blob, nome: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}

export default function AsaasLote() {
  const avisar = useAviso()
  const { config } = useApp()
  const [mes, setMes] = useState(() => config.competencia_atual ? mesSeguinte(config.competencia_atual) : new Date().toISOString().slice(0, 7))
  const [listas, setListas] = useState<Record<string, BoletoLote[] | undefined>>({})
  // boletos marcados por grupo: ao buscar, todos vêm marcados; dá para desmarcar algum antes de gerar
  const [marc, setMarc] = useState<Record<string, Set<string>>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [prog, setProg] = useState('')
  const [mm, aa] = [mes.slice(5), mes.slice(0, 4)]

  async function buscar(grupo: string) {
    setOcupado(grupo); setProg('Consultando o Asaas…')
    try {
      const r = await chamarAsaas<{ boletos: BoletoLote[]; clientesNoGrupo: number }>('lote', { grupo, mes })
      setListas(l => ({ ...l, [grupo]: r.boletos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) }))
      setMarc(m => ({ ...m, [grupo]: new Set(r.boletos.map(b => b.id)) }))
      if (!r.clientesNoGrupo) avisar(`Nenhum cliente no grupo "${grupo}" do Asaas. Confira o nome do grupo no cadastro dos clientes no Asaas.`, 'erro')
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setOcupado(null); setProg('') }
  }

  async function gerar(grupo: string) {
    const lista = (listas[grupo] || []).filter(b => marc[grupo]?.has(b.id))
    if (!lista.length) return avisar('Marque ao menos um boleto.', 'erro')
    setOcupado(grupo)
    try {
      const { out, erros } = await baixarPdfs(lista, n => setProg(`Baixando boletos ${n}/${lista.length}…`))
      if (!out.length) throw new Error('Nenhum boleto foi baixado. ' + erros.join(' · '))
      setProg('Montando o arquivo…')
      if (grupo === 'Impressos') {
        const { PDFDocument } = await import('pdf-lib')
        const doc = await PDFDocument.create()
        for (const { bytes } of out) {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
          for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg)
        }
        salvar(new Blob([await doc.save() as BlobPart], { type: 'application/pdf' }), `Boletos Impressos ${mm}-${aa}.pdf`)
      } else {
        const JSZip = (await import('jszip')).default
        const zip = new JSZip(); const usados = new Set<string>()
        for (const { b, bytes } of out) {
          let n = `${nomeArq(b.nome)} - Boleto ${mm}-${aa}`
          for (let i = 2; usados.has(n); i++) n = `${nomeArq(b.nome)} - Boleto ${mm}-${aa} (${i})`   // mesmo cliente com 2 boletos
          usados.add(n); zip.file(`${n}.pdf`, bytes)
        }
        salvar(await zip.generateAsync({ type: 'blob' }), `Boletos Acessorias ${mm}-${aa}.zip`)
      }
      avisar(erros.length ? `${out.length} boleto(s) no arquivo; ${erros.length} com erro: ${erros.join(' · ')}` : `${out.length} boleto(s) no arquivo.`, erros.length ? 'erro' : undefined)
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setOcupado(null); setProg('') }
  }

  return <>
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-sm"><span className="rotulo">Vencimento no mês</span>
        <input type="month" className="campo w-44" value={mes} onChange={e => { setMes(e.target.value); setListas({}); setMarc({}) }} /></label>
      <p className="pb-2 text-sm text-slate-500">Entram os boletos <b>pendentes</b> com vencimento em {mm}/{aa} dos clientes de cada grupo do Asaas. Gere depois de fazer os ajustes do mês.</p>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      {GRUPOS.map(g => {
        const lista = listas[g.grupo]
        const sel = marc[g.grupo] || new Set<string>()
        const marcados = (lista || []).filter(b => sel.has(b.id))
        const total = marcados.reduce((s, b) => s + b.valor, 0)
        const alternar = (id: string) => setMarc(m => { const n = new Set(m[g.grupo]); if (n.has(id)) n.delete(id); else n.add(id); return { ...m, [g.grupo]: n } })
        const todos = !!lista?.length && marcados.length === lista.length
        return <Cartao key={g.grupo} titulo={<span className="inline-flex items-center gap-2">{g.grupo === 'Impressos' ? <Icone nome="impressora" className="h-4 w-4 text-blue-600" /> : <img src="/acessorias.png" alt="" className="h-4 w-4 object-contain" />}Grupo {g.titulo} <span className="text-xs font-normal text-slate-400">· {g.saida}</span></span>}
          acoes={<div className="flex gap-2">
            <Botao variante="secundario" onClick={() => buscar(g.grupo)} disabled={!!ocupado}>{lista ? 'Buscar de novo' : 'Buscar boletos'}</Botao>
            {lista && lista.length > 0 && <Botao onClick={() => gerar(g.grupo)} disabled={!!ocupado || !marcados.length}>{g.grupo === 'Impressos' ? `Gerar PDF (${marcados.length})` : `Baixar ZIP (${marcados.length})`}</Botao>}
          </div>}>
          {ocupado === g.grupo && <p className="border-b border-slate-100 bg-blue-50 px-5 py-2 text-sm text-blue-700">{prog}</p>}
          {!lista ? <Vazio texto={`Clique em "Buscar boletos" para listar os boletos de ${mm}/${aa}.`} /> : lista.length === 0 ? <Vazio texto="Nenhum boleto pendente desse grupo no mês." /> : <>
            <label className="flex cursor-pointer items-center gap-3 px-5 pt-3 text-sm text-slate-600">
              <input type="checkbox" checked={todos} onChange={() => setMarc(m => ({ ...m, [g.grupo]: todos ? new Set() : new Set(lista.map(b => b.id)) }))} />
              <span><b>{marcados.length}</b> de {lista.length} boleto(s) marcados · total <b className="num">{moeda(total)}</b></span></label>
            <ul className="mt-1 max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {lista.map(b => <li key={b.id} className={`flex items-center gap-3 px-5 py-1.5 text-sm ${sel.has(b.id) ? '' : 'opacity-50'}`}>
                <input type="checkbox" checked={sel.has(b.id)} onChange={() => alternar(b.id)} />
                <span className="min-w-0 flex-1 cursor-pointer truncate text-slate-700" onClick={() => alternar(b.id)}>{b.nome}</span>
                <span className="text-xs text-slate-400">vence {data(b.vencimento)}</span>
                <span className="num w-24 text-right">{moeda(b.valor)}</span>
                <button className="text-xs text-marca-700 hover:underline" onClick={() => abrirBoleto({ id: b.id }).catch(e => avisar((e as Error).message, 'erro'))}><span className="inline-flex items-center gap-1"><LogoAsaas className="h-3 w-3" />Boleto</span></button>
              </li>)}
            </ul>
          </>}
        </Cartao>
      })}
    </div>
  </>
}
