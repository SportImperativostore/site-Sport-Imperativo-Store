# Sport Imperativo Store — E-commerce

**AQUI VOCÊ VESTE O ESPORTE.**

Plataforma de e-commerce completa (loja + painel administrativo + API), sem build step, com poucas dependências (`express`, `compression`) e banco SQLite embutido (`node:sqlite`).

## Rodar

Requer Node.js ≥ 22.5 (testado no 24).

```bash
npm install
npm start          # http://localhost:3000   (admin em /admin/)
```

Na **primeira execução** o banco é criado com dados **demonstrativos** (≈250 produtos fictícios, ligas, clubes, banners, cupons) e a senha do administrador é exibida **uma única vez** no console (ou defina `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Copie `.env.example` para `.env` para configurar.

Cupons de teste: `BEMVINDO10` (10 % na 1ª compra, exige login) e `FRETEGRATIS` (pedido ≥ R$ 199).

## Arquitetura

```
server/
  index.js            app Express, headers de segurança, SEO (meta/OG/JSON-LD), sitemap, robots
  db.js               schema SQLite (relacional) + helpers
  seed.js             dados iniciais demonstrativos
  lib/catalog.js      preços, disponibilidade, busca, filtros/facetas, menu dinâmico
  lib/cart.js         precificação no servidor, cupons, frete por grupo (pronta entrega × importado)
  lib/orders.js       pedidos, baixa de estoque, ordens ao fornecedor, linha do tempo
  lib/payments.js     gateway (Mercado Pago) + modo de teste
  lib/auth.js         scrypt, sessões em cookie HttpOnly, proteção CSRF
  routes/store.js     API pública (catálogo, busca, produto, CEP, carrinho)
  routes/account.js   auth, conta, favoritos, avaliações, checkout, webhooks, LGPD
  routes/admin.js     API administrativa (CRUD, pedidos, fornecedores, uploads, backup)
public/               loja (SPA em JS puro com History API) e /admin (painel)
```

### Modelo de dados dinâmico

Tudo que é "categorização" é uma **entidade** (`entities`): esporte, categoria, país, liga, competição, clube, seleção, marca, modelo, modalidade, piloto, coleção. Relações:

- `entity_links(parent, child)` — hierarquia do menu (liga → clubes; esporte → ligas/categorias; marca → modelos…).
- `product_entities(produto, entidade)` — **muitos-para-muitos**: um produto pode pertencer a vários clubes, categorias, ligas, países, coleções.

URLs são conjuntos de slugs **em qualquer ordem**: `/futebol/brasil/santos`, `/futebol/retro/santos`, `/futebol/premier-league/liverpool`, `/futebol/santos/retro` resolvem para o mesmo tipo de consulta (produtos que possuem *todas* as entidades). Criar novos clubes/ligas/categorias no admin atualiza menu, mega menu, filtros, sitemap e busca **sem alterar código**.

### Tipos de envio e frete

Por produto: `fulfillment` = `stock` (pronta entrega, controla estoque por tamanho) ou `import` (sob encomenda, não depende de estoque próprio) e `shipping_rule` = `cep` | `free` | `fixed` | `custom`. O carrinho agrupa os itens em **grupos de envio** (pronta entrega / importado), calcula cada um e exibe origem, prazo e valor no produto, carrinho e checkout. Para importados o checkout exige o aceite explícito do aviso de importação (prazo maior, tributos/taxas conforme legislação) antes do pagamento.

### Fornecedores

Cada produto pode ter fornecedor (SKU, custo, link — dados **internos**, nunca enviados ao cliente). Ao aprovar o pagamento, o sistema cria uma **ordem de compra por fornecedor** com a mensagem "NOVO PEDIDO — SPORT IMPERATIVO STORE …" e:

- **Webhook/API**: dispara automaticamente (POST JSON) e registra o resultado.
- **WhatsApp**: gera o link `wa.me` com a mensagem pré-preenchida (botão no pedido do admin) — o envio é assistido, pois a API oficial do WhatsApp exige conta Business/provedor.
- **E-mail**: mensagem pronta para copiar/enviar (nenhum SMTP está configurado por padrão).

Status: Aguardando fornecedor → Enviado ao fornecedor → Fornecedor confirmou → Em preparação → Enviado → Em trânsito → Entregue (alteráveis manualmente no admin, com código/link de rastreio por envio).

## Para entrar em produção — IMPORTANTE

1. **Pagamento**: defina `MP_ACCESS_TOKEN` (Mercado Pago). Pix é criado via API; cartão usa **Checkout Pro** (o cartão nunca passa pelo seu servidor). Cadastre o webhook `https://SEU-DOMINIO/api/webhooks/mercadopago`. Sem token a loja roda em *modo de teste* com botão "Simular pagamento" — **a integração real não foi testada contra o gateway**; faça um teste em sandbox antes de vender.
2. **Frete**: o cálculo de pronta entrega usa uma **tabela estimada por região** (`server/lib/cart.js → quoteStock`). Troque por Melhor Envio/Correios/Frenet nesse ponto único antes de operar.
3. **HTTPS** (proxy reverso: Nginx/Caddy/Cloudflare) e `NODE_ENV=production` (cookie `Secure` + HSTS). Defina `PUBLIC_URL`.
4. **Conteúdo**: substitua produtos/fotos demo, preencha WhatsApp, Instagram, CNPJ e fornecedores reais em *Configurações* e *Fornecedores*. As páginas de Privacidade/Termos/Trocas são **modelos** — revise com assessoria jurídica (LGPD/CDC).
5. **Backup**: *Admin → Logs / Backup* baixa uma cópia consistente do banco; agende também cópia de `data/` e `uploads/`.
6. Rate-limit e sessões são em memória/SQLite (instância única). Para várias instâncias, use Redis/Postgres e CDN para `/uploads`.
7. Notas fiscais, cálculo de tributos de importação e integração com ERP não estão incluídos.

## Segurança implementada

Senhas com scrypt; sessão em cookie HttpOnly/SameSite; proteção CSRF (header + Origin); CSP restritiva, `nosniff`, frame deny; validação de CPF/e-mail/CEP; preços, estoque, frete e cupons sempre recalculados no servidor; webhook confirma o pagamento consultando a API do gateway; controle de acesso do admin; log de auditoria; limite de tentativas em login/checkout; exportação e exclusão de dados do cliente (LGPD); banner de consentimento de cookies.
