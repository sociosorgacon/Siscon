export type Coluna = { titulo: string; chave: string; largura?: number; tipo?: 'moeda' | 'data' | 'texto' | 'numero' }
export type Aba = { nome: string; titulo: string; colunas: Coluna[]; linhas: Record<string, unknown>[]; total?: string[] }

/** Gera .xlsx com uma aba por relatório, cabeçalho fixo, altura de linha padrão e filtros. */
export async function baixarExcel(nomeArquivo: string, abas: Aba[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Siscon'
  for (const a of abas) {
    const ws = wb.addWorksheet(a.nome.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] })
    ws.properties.defaultRowHeight = 15
    ws.mergeCells(1, 1, 1, a.colunas.length)
    ws.getCell(1, 1).value = a.titulo
    ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: 'FF0F3D3E' } }
    ws.getCell(2, 1).value = `Gerado em ${new Date().toLocaleString('pt-BR')}`
    ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF64748B' } }
    ws.columns = a.colunas.map(c => ({ key: c.chave, width: c.largura ?? 16 }))
    const cab = ws.getRow(3)
    a.colunas.forEach((c, i) => { cab.getCell(i + 1).value = c.titulo })
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4F4D' } }
    for (const l of a.linhas) {
      const row = ws.addRow(a.colunas.map(c => {
        const v = l[c.chave]
        if (c.tipo === 'data' && typeof v === 'string' && v) { const [y, m, d] = v.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
        return v ?? ''
      }))
      row.height = 15
    }
    a.colunas.forEach((c, i) => {
      const col = ws.getColumn(i + 1)
      if (c.tipo === 'moeda') col.numFmt = '#,##0.00'
      if (c.tipo === 'data') col.numFmt = 'dd/mm/yyyy'
      col.alignment = { vertical: 'middle', wrapText: false }
    })
    if (a.total?.length && a.linhas.length) {
      const ini = 4, fim = 3 + a.linhas.length
      const tr = ws.addRow(a.colunas.map((c, i) => i === 0 ? 'TOTAL' : a.total!.includes(c.chave)
        ? { formula: `SUBTOTAL(9,${col(i + 1)}${ini}:${col(i + 1)}${fim})` } : ''))
      tr.font = { bold: true }; tr.height = 15
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: a.colunas.length } }
  }
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: nomeArquivo })
  link.click(); URL.revokeObjectURL(url)
}

const col = (n: number) => { let s = ''; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
