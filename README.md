# 📊 Data Logger - Análise de Pressão

![Status](https://img.shields.io/badge/status-ativo-brightgreen)
![Licença](https://img.shields.io/badge/licença-MIT-blue)
![Plataforma](https://img.shields.io/badge/plataforma-web-blueviolet)

Ferramenta web para análise de pressão em manutenções industriais e atendimentos técnicos. Carregue um arquivo CSV, visualize gráficos interativos, detecte automaticamente picos e pontos de estabilidade, e gere relatórios profissionais prontos para impressão em formato A4.

🔗 **Acesse o sistema online:** [https://abl0n.github.io/gasGrafico/](https://abl0n.github.io/gasGrafico/)

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
| **JavaScript (Vanilla)** | Lógica de processamento e interatividade |
| **[Chart.js](https://www.chartjs.org/)** | Renderização do gráfico de pressão |
| **[Papa Parse](https://www.papaparse.com/)** | Leitura e parsing de arquivos CSV |
| **GitHub Pages** | Hospedagem estática e gratuita |

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