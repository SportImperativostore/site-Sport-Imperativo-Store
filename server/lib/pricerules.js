/* Tipos de produto para a "Tabela de preços" do painel. Cada produto cai no PRIMEIRO tipo que combina (a ordem importa).
 * Alterar o preço de um tipo no painel atualiza todos os produtos daquele tipo. */
const has = (n, ...ws) => ws.some((w) => n.includes(w));
const RULES = [
  { key: 'f1-camiseta', label: 'F1 — Camiseta e Polo', test: (n) => n.startsWith('Camiseta F1') || n.startsWith('Polo F1') },
  { key: 'f1-moletom', label: 'F1 — Moletom e Jaqueta', test: (n) => n.startsWith('Moletom F1') || n.startsWith('Jaqueta F1') },
  { key: 'calcao-jogador', label: 'Calção — versão jogador', test: (n) => n.startsWith('Calção') && has(n, 'Player Version', 'Jogador', 'Authentic') },
  { key: 'calcao', label: 'Calção', test: (n) => n.startsWith('Calção') },
  { key: 'chuteira', label: 'Chuteiras', test: (n) => n.startsWith('Chuteira') },
  { key: 'nfl', label: 'NFL — camisas', test: (n) => has(n, 'NFL') },
  { key: 'nba-calcao', label: 'NBA — calções', test: (n) => n.startsWith('Calção NBA') },
  { key: 'nba', label: 'NBA — camisas, regatas e jaquetas', test: (n) => has(n, 'NBA') },
  { key: 'agasalho', label: 'Agasalhos e conjuntos de treino', test: (n) => /^(Corta-Vento|Jaqueta|Moletom|Conjunto de Treino|Trench|Casaco)/.test(n) },
  { key: 'infantil', label: 'Kit infantil', test: (n) => n.startsWith('Kit Infantil') },
  { key: 'retro-ml', label: 'Camisa retrô — manga longa', test: (n) => /Retro/.test(n) && has(n, 'Manga Longa') },
  { key: 'retro', label: 'Camisa retrô', test: (n) => /Retro/.test(n) },
  { key: 'manga-longa', label: 'Camisa manga longa', test: (n) => has(n, 'Manga Longa') },
  { key: 'feminina', label: 'Camisa feminina', test: (n) => has(n, 'Feminina') },
  { key: 'jogador', label: 'Camisa versão jogador (Player Version)', test: (n) => has(n, 'Player Version') },
  { key: 'especial', label: 'Camisa edição especial', test: (n) => has(n, 'Edição Especial', 'Aniversário', 'Special') },
  { key: 'torcedor', label: 'Camisa torcedor (padrão)', test: (n) => n.startsWith('Camisa') },
];
const ruleOf = (name) => (RULES.find((r) => r.test(String(name || ''))) || {}).key || null;
module.exports = { RULES, ruleOf };
