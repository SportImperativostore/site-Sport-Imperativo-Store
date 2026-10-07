# Sport Imperativo Store — E-commerce

**AQUI VOCÊ VESTE O ESPORTE.**

Plataforma de e-commerce completa (loja + painel administrativo + API), sem build step, com poucas dependências (`express`, `compression`) e banco SQLite embutido (`node:sqlite`).

## Rodar localmente

Requer Node.js ≥ 20.

```bash
npm install
npm start          # http://localhost:3000   (admin em /admin/)
```

Sem variáveis de banco, usa o arquivo local `data/store.db`. Na **primeira execução** o banco é criado com dados **demonstrativos** (≈250 produtos fictícios) e a senha do administrador aparece **uma única vez** no console (ou defina `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Cupons de teste: `BEMVINDO10` (1ª compra, exige login) e `FRETEGRATIS` (≥ R$ 199).

## Publicar na Vercel

A Vercel é *serverless* (sem disco persistente), por isso o projeto usa **Turso (libSQL/SQLite remoto)** para o banco e **Vercel Blob** para uploads.

1. **Banco (Turso)** — crie conta em turso.tech (ou use a integração Turso no Marketplace da Vercel). Escolha a região mais próxima da região das funções da Vercel (ex.: `gru`/`iad`).
   ```bash
   turso db create sport-imperativo
   turso db show sport-imperativo --url          # → TURSO_DATABASE_URL
   turso db tokens create sport-imperativo       # → TURSO_AUTH_TOKEN
   ```
2. **Inicialize o banco (uma vez, do seu computador)** com as variáveis acima no `.env`:
   ```bash
   npm run db:setup     # estrutura base + admin, SEM produtos  (recomendado para loja real)
   # ou
   npm run db:seed      # com 245 produtos de demonstração
   ```
   Defina antes `ADMIN_EMAIL` e `ADMIN_PASSWORD` no `.env`.
3. **Vercel** → *Add New Project* → importe o repositório do GitHub (framework "Other"; não precisa de build).
4. **Storage → Blob → Create** e conecte ao projeto (gera `BLOB_READ_WRITE_TOKEN`).
5. **Settings → Environment Variables**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `PUBLIC_URL` (https://seu-dominio) e `MP_ACCESS_TOKEN` (veja `.env.example`). Faça *Redeploy*.
6. Cadastre o webhook do Mercado Pago: `https://SEU-DOMINIO/api/webhooks/mercadopago`.

Particularidades da Vercel já tratadas no código: banco assíncrono remoto (sem arquivo SQLite), uploads em Blob, webhook processado antes de responder, páginas com SEO geradas pela função (`server/shell.html`) e cache de CDN (`s-maxage`) nas rotas públicas. **Limites:** upload direto pelo admin até ~4 MB por arquivo (vídeos maiores: use link do YouTube/Instagram ou URL externa); sem credenciais do gateway o checkout fica **bloqueado** em produção (defina `ALLOW_MOCK_PAYMENTS=1` apenas para demonstração).

## Arquitetura

```
server/
  index.js            app Express, headers de segurança, SEO (meta/OG/JSON-LD), sitemap, robots
  db.js / schema.js   cliente libSQL (Turso ou arquivo local), schema relacional, cache de configurações
  seed.js             dados iniciais (em lote)  •  scripts/seed.js (npm run db:setup | db:seed)
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
3. **HTTPS** já vem na Vercel. Defina `PUBLIC_URL` e conecte o domínio próprio.
4. **Conteúdo**: substitua produtos/fotos demo, preencha WhatsApp, Instagram, CNPJ e fornecedores reais em *Configurações* e *Fornecedores*. As páginas de Privacidade/Termos/Trocas são **modelos** — revise com assessoria jurídica (LGPD/CDC).
5. **Backup**: *Admin → Logs / Backup* baixa um export JSON; no Turso use também `turso db shell NOME .dump` e os backups/point-in-time do plano.
6. O limitador de tentativas é em memória (por instância serverless); para proteção forte use o Vercel Firewall/WAF ou Upstash Redis.
7. Notas fiscais, cálculo de tributos de importação e integração com ERP não estão incluídos.

## Segurança implementada

Senhas com scrypt; sessão em cookie HttpOnly/SameSite; proteção CSRF (header + Origin); CSP restritiva, `nosniff`, frame deny; validação de CPF/e-mail/CEP; preços, estoque, frete e cupons sempre recalculados no servidor; webhook confirma o pagamento consultando a API do gateway; controle de acesso do admin; log de auditoria; limite de tentativas em login/checkout; exportação e exclusão de dados do cliente (LGPD); banner de consentimento de cookies.

## Importar o catálogo real (fotos incluídas)

Os dados e as fotos do catálogo atual (MeuKatálogo) foram levantados para `D:\loja\catalogo-import\` (1.741 produtos, 227 times, ~3.700 imagens WebP 720 px). Para publicar:

1. Vercel → **Storage → Blob → Create**, conecte ao projeto e copie o `BLOB_READ_WRITE_TOKEN` para o `.env` local.
2. `node scripts/catalog-import.js --dir=D:/loja/catalogo-import --blob` — envia as imagens ao Blob (CDN) e grava ligas, times, produtos, tamanhos e fotos no banco (Turso). Com `--dry` apenas mostra o resumo; sem `--keep-demo` apaga os produtos/clubes de demonstração.
3. Para testar localmente sem Blob: `--local` (copia as imagens para `public/img/catalog/`, que não vai ao Git).

Ao importar, os produtos entram como **sob encomenda/importado, frete grátis, prazo 15–30 dias úteis** (padrão da loja) — ajuste por produto no admin se algum for pronta entrega.

## Pós-venda automático (WhatsApp Business + e-mail)

Fluxo: **cliente paga → pedido #SIS-1xxxx → mensagem ao fornecedor pelo WhatsApp Business DA LOJA (+55 11 91776-5409) → fornecedor responde → status e rastreio registrados → cliente recebe e-mail**. O cliente nunca vê o número do fornecedor (que fica só no backend/admin) e o fornecedor só conversa com a loja. Código: `server/lib/automation.js` (Order Automation), `server/lib/whatsapp.js` (Cloud API), `server/routes/whatsapp.js` (webhook + admin).

**O que já está pronto no sistema:** envio idempotente (nunca duplica), mensagem no formato combinado (somente dados necessários; sem custo/margem/cartão), webhook com assinatura (`X-Hub-Signature-256`), respostas do fornecedor ("Pedido recebido." → confirmou; código de rastreio → em trânsito), caixa **"RASTREIO PRECISA DE IDENTIFICAÇÃO"**, log "Conversa com fornecedor" por pedido, e-mail "Seu pedido foi enviado" com botão, painel **Admin → WhatsApp / Pós-venda**, e **fallback manual** (botões "Enviar pedido pelo WhatsApp" e "Copiar mensagem") enquanto a API não estiver configurada. Testado de ponta a ponta com uma API simulada (`node scripts/test-whatsapp-flow.js <banco>`).

**O que você precisa fazer para ligar a API oficial (a Meta exige):**
1. Em business.facebook.com crie/escolha seu **Meta Business** e verifique a empresa. Em developers.facebook.com crie um **app** do tipo *Business* e adicione o produto **WhatsApp**.
2. Cadastre o número **+55 11 91776-5409** na **WhatsApp Business Platform** (WhatsApp Manager). ⚠ Um número que já está no aplicativo WhatsApp Business no celular precisa ser **migrado** para a API (ou usar o modo "coexistência", se disponível para você) — não funciona nos dois ao mesmo tempo sem isso.
3. Gere um **token permanente** (Usuário do Sistema com permissão `whatsapp_business_messaging`). Anote: **Phone Number ID**, **WhatsApp Business Account ID**, **App Secret**.
4. No **WhatsApp Manager → Modelos de mensagem** crie o template **`novo_pedido_fornecedor`** (idioma `pt_BR`, categoria **Utilidade**) com o texto exato mostrado em *Admin → WhatsApp → Template* e aguarde a aprovação. (A Meta só permite que a loja inicie conversa com o fornecedor via template aprovado; dentro de 24 h depois que o fornecedor responde, o sistema usa texto livre.)
5. No app da Meta → WhatsApp → **Configuração → Webhook**: URL `https://SEU-SITE/api/webhooks/whatsapp`, token de verificação = o valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; assine o campo **messages**.
6. Na Vercel cadastre as variáveis (veja `.env.example`) e faça **Redeploy**. O painel mostrará "● WhatsApp conectado".
7. (E-mail) Crie conta no Resend, verifique seu domínio e cadastre `RESEND_API_KEY` e `MAIL_FROM`.
