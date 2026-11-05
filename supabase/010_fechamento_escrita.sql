-- Siscon — cliente marca se gera Fechamento de Escrita (rodar depois do 009). Seguro rodar de novo.
-- Padrão = sim (todos os clientes atuais e novos); desmarcar no cadastro do cliente quem não tem fechamento.
alter table clientes add column if not exists gera_fechamento boolean not null default true;

select count(*) filter (where gera_fechamento) as geram_fechamento, count(*) filter (where not gera_fechamento) as nao_geram
from clientes where status = 'Ativo';
