"""Gera supabase/importacao.sql a partir do backup JSON do Base44.

Uso: python3 scripts/gerar_importacao.py dados/siscon_backup_AAAA-MM-DD.json
O SQL gerado contém dados de clientes: NÃO versionar (está no .gitignore).
"""
import json, sys, uuid
from pathlib import Path

NS = uuid.UUID("5f1c0e2a-7d3b-4c1e-9a8f-0b6d2e4c8a10")  # ids determinísticos: reimportar gera os mesmos ids


def novo_id(tabela, legacy):
    return str(uuid.uuid5(NS, f"{tabela}:{legacy}"))


def q(v):
    if v is None or v == "":
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if isinstance(v, float) else str(v)
    return "'" + str(v).replace("'", "''") + "'"


def comp(mmaaaa):
    """'09/2026' -> '2026-09-01'"""
    if not mmaaaa:
        return None
    m, a = mmaaaa.split("/")
    return f"{a}-{int(m):02d}-01"


def data(v):
    """Aceita AAAA-MM-DD(...) e DD/MM/AAAA (o Base44 gravou dos dois jeitos)."""
    if not v:
        return None
    v = v.strip()
    if len(v) >= 10 and v[2] == "/" and v[5] == "/":
        return f"{v[6:10]}-{v[3:5]}-{v[0:2]}"
    return v[:10]


SITUACAO = {"ATIVA": "ATIVA", "ATIVO": "ATIVA", "BAIXADA": "BAIXADA", "PARALISADA": "PARALISADA",
            "NAO ENCONTRADO": "NÃO ENCONTRADA"}


def situacao(v):
    if not v or not v.strip():
        return None
    return SITUACAO.get(v.strip().upper(), v.strip().upper())


def uf(v):
    v = "".join(ch for ch in (v or "") if ch.isalpha()).upper()
    return v if len(v) == 2 else None


def so_digitos(v):
    return "".join(c for c in (v or "") if c.isdigit()) or None


def insert(tabela, linhas):
    if not linhas:
        return ""
    cols = list(linhas[0].keys())
    vals = ",\n".join("(" + ", ".join(q(l[c]) for c in cols) + ")" for l in linhas)
    return f"insert into {tabela} ({', '.join(cols)}) values\n{vals};\n\n"


def main(caminho):
    d = json.loads(Path(caminho).read_text(encoding="utf-8"))
    avisos = []

    cli_map = {c["id"]: novo_id("cliente", c["id"]) for c in d["Cliente"]}
    clientes = [{
        "id": cli_map[c["id"]], "legacy_id": c["id"], "cnpj": so_digitos(c["cnpj"]) or c["cnpj"],
        "razao_social": c["razao_social"].strip(), "nome_fantasia": c.get("nome_fantasia"),
        "email": c.get("email"), "telefone": c.get("telefone"), "logradouro": c.get("logradouro"),
        "municipio": c.get("municipio"), "uf": uf(c.get("uf")), "situacao": situacao(c.get("situacao")),
        "status": c["status"], "percentual_honorario": c.get("percentual_honorario") or 0,
        "dia_vencimento": c.get("dia_vencimento") or 7, "multa_por_atraso": bool(c.get("multa_por_atraso")),
        "created_at": c["created_date"],
    } for c in d["Cliente"]]

    cfg = {c["chave"]: c for c in d["Configuracao"]}
    configs = [{"chave": k, "valor": v["valor"], "descricao": v.get("descricao")} for k, v in cfg.items()]

    hon_map, honorarios = {}, []
    for h in d["Honorario"]:
        if h["cliente_id"] not in cli_map:
            avisos.append(f"Honorário {h['id']} sem cliente ({h['cliente_nome']}) — ignorado")
            continue
        hon_map[h["id"]] = novo_id("honorario", h["id"])
        honorarios.append({
            "id": hon_map[h["id"]], "legacy_id": h["id"], "cliente_id": cli_map[h["cliente_id"]],
            "competencia": comp(h["competencia"]), "vencimento": data(h["vencimento"]),
            "valor_original": h["valor_original"], "juros": h.get("juros") or 0,
            "valor_atualizado": h["valor_atualizado"], "status": h["status"],
            "calcular_juros": bool(h.get("calcular_juros")), "valor_pago": h.get("valor_pago"),
            "valor_pago_acumulado": h.get("valor_pago_acumulado") or 0,
            "data_pagamento": data(h.get("data_pagamento")), "metodo_pagamento": h.get("metodo_pagamento"),
            "observacao": h.get("observacao"), "created_at": h["created_date"],
        })

    des_map, despesas = {}, []
    for x in d["Despesa"]:
        if x["cliente_id"] not in cli_map:
            avisos.append(f"Despesa {x['id']} sem cliente ({x['cliente_nome']}) — ignorada")
            continue
        des_map[x["id"]] = novo_id("despesa", x["id"])
        despesas.append({
            "id": des_map[x["id"]], "legacy_id": x["id"], "cliente_id": cli_map[x["cliente_id"]],
            "descricao": x["descricao"], "valor": x["valor"], "data": data(x["data"]),
            "competencia": comp(x["competencia"]), "status": x["status"],
            "valor_pago": x.get("valor_pago") or (x["valor"] if x["status"] == "Pago" else 0),
            "data_pagamento": data(x.get("data_pagamento")), "metodo_pagamento": x.get("metodo_pagamento"),
            "observacoes": x.get("observacoes") or None, "created_at": x["created_date"],
        })

    # cliente do recibo: pelo id; se faltar, pelo CNPJ ou nome
    por_cnpj = {so_digitos(c["cnpj"]): cli_map[c["id"]] for c in d["Cliente"] if so_digitos(c["cnpj"])}
    por_nome = {c["razao_social"].strip().upper(): cli_map[c["id"]] for c in d["Cliente"]}
    recibos, itens, avulsos = [], [], []
    for r in d["Recibo"]:
        rid = novo_id("recibo", r["id"])
        cid = cli_map.get(r.get("cliente_id")) or por_cnpj.get(so_digitos(r.get("cliente_cnpj"))) \
            or por_nome.get((r.get("cliente_nome") or "").strip().upper())
        if not cid:
            avulsos.append(r["cliente_nome"])
        recibos.append({
            "id": rid, "legacy_id": r["id"], "numero": int(r["numero_recibo"]) or None,  # 0 = gerado sem número pela conciliação "cliente_id": cid,
            "cliente_nome": r["cliente_nome"], "cliente_cnpj": r.get("cliente_cnpj"), "valor": r["valor"],
            "data_pagamento": data(r["data_pagamento"]), "created_at": r["created_date"],
        })
        for it in r.get("itens_pagos") or []:
            itens.append({
                "recibo_id": rid, "tipo": it.get("tipo") or "Honorário Contábil",
                "descricao": it.get("descricao") or "", "valor": it.get("valor") or 0,
                "competencia": comp(it.get("competencia")),
                "honorario_id": hon_map.get(it.get("honorario_id")), "despesa_id": des_map.get(it.get("despesa_id")),
            })

    if avulsos:
        avisos.append(f"{len(avulsos)} recibos avulsos (pessoa sem cadastro de cliente) — mantidos sem vínculo")
    numeros = [r["numero"] for r in recibos if r["numero"]]
    sem_num = len(recibos) - len(numeros)
    if sem_num:
        avisos.append(f"{sem_num} recibos antigos sem número (gerados pela conciliação do Base44) — importados com número vazio")
    dup = {n for n in numeros if numeros.count(n) > 1}
    if dup:
        avisos.append(f"Números de recibo duplicados: {sorted(dup)} — renumere antes de importar")

    sql = ["-- Gerado por scripts/gerar_importacao.py — CONTÉM DADOS DE CLIENTES\nbegin;\n\n",
           insert("configuracoes", configs), insert("clientes", clientes), insert("honorarios", honorarios),
           insert("despesas", despesas), insert("recibos", recibos), insert("recibo_itens", itens),
           f"select setval('recibo_numero_seq', {max(numeros)});\ncommit;\n"]
    saida = Path(__file__).resolve().parent.parent / "supabase" / "importacao.sql"
    saida.write_text("".join(sql), encoding="utf-8")

    print(f"Clientes {len(clientes)} | Honorários {len(honorarios)} | Despesas {len(despesas)} | "
          f"Recibos {len(recibos)} ({len(itens)} itens) | Próximo recibo: {max(numeros) + 1}")
    print(f"Avisos: {len(avisos)}")
    for a in avisos:
        print(" -", a)


if __name__ == "__main__":
    main(sys.argv[1])
