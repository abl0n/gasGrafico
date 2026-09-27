# 📊 Data Logger - Análise de Pressão

![Status](https://img.shields.io/badge/status-ativo-brightgreen)
![Licença](https://img.shields.io/badge/licença-MIT-blue)
![Plataforma](https://img.shields.io/badge/plataforma-web-blueviolet)
![Zero deps](https://img.shields.io/badge/dependências-zero-success)

Ferramenta web para análise de pressão em manutenções industriais e atendimentos técnicos. Carregue um arquivo CSV, visualize gráficos interativos, detecte automaticamente picos e pontos de estabilidade, e gere relatórios profissionais prontos para impressão em formato A4.

🔗 **Acesse o sistema online:** [https://abl0n.github.io/gasGrafico/](https://abl0n.github.io/gasGrafico/)

> 🔐 **CSP rígida:** `default-src 'none'` + `script-src 'self'` — o app não carrega nada de fora.

---

## 🚀 Funcionalidades

- 📂 **Upload de CSV**: Carregue arquivos com dados de pressão (data/hora e valor).
- 📈 **Gráfico interativo**: Visualize a curva de pressão com destaque para picos e estabilidades.
- 🔴 **Detecção automática de picos**: Identifica variações acima de 5% em relação à pressão de referência.
- 🟢 **Pontos de estabilidade**: Marca visualmente onde a pressão se estabiliza.
- 📋 **Tabela de picos**: Lista ordenada com horário, valor, diferença percentual e status.
- 📊 **Estatísticas rápidas**: Máxima, mínima, média, maior pico e total de ocorrências.
- 🖨️ **Relatório em A4**: Geração de relatório formatado para impressão, com logo, dados da manutenção e equipe responsável.
- 🔒 **Totalmente offline e seguro**: Todos os dados processados localmente no seu navegador. Nenhuma informação é enviada para servidores externos.

---

## 🛠️ Tecnologias Utilizadas

| Ferramenta | Descrição |
| :--- | :--- |
| **HTML5 / CSS3** | Estrutura e estilização da interface |
| **JavaScript (Vanilla)** | Lógica de processamento, parsing CSV e gráfico |
| **Canvas API** | Renderização do gráfico de pressão (nativo) |
| **GitHub Pages** | Hospedagem estática e gratuita |

> 🎯 **Zero dependências externas.** Sem CDNs, sem bibliotecas de terceiros — o app funciona 100% offline e o único código executado é o do próprio projeto.

---

## 📂 Formato do Arquivo CSV

O arquivo deve conter **duas colunas** (sem cabeçalho obrigatório, mas recomendado):

| Coluna 1 | Coluna 2 |
| :--- | :--- |
| Data/Hora (ex: `2025-01-15 14:30:00`) | Pressão (ex: `0.352`) |

**Exemplo:**
```csv
2025-01-15 14:30:00,0.352
2025-01-15 14:30:05,0.355
2025-01-15 14:30:10,0.348
```

Suporta separadores `,`, `;`, `\t` e `|`. Aspas duplas com escape (`""`) também são tratadas.

---

## 📦 Como rodar localmente

Por causa da CSP, sirva via HTTP (não abra com `file://`):

```bash
python -m http.server 8000
# ou
npx serve .
```

Acesse `http://localhost:8000`.

---

## 📝 Licença

MIT