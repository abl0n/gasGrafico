# 📊 Data Logger - Análise de Pressão

![Status](https://img.shields.io/badge/status-ativo-brightgreen)
![Licença](https://img.shields.io/badge/licença-MIT-blue)
![Plataforma](https://img.shields.io/badge/plataforma-web-blueviolet)
![Zero deps](https://img.shields.io/badge/dependências-zero-success)
![PWA](https://img.shields.io/badge/PWA-instalável-blue)
![Offline](https://img.shields.io/badge/offline-100%25-success)

Ferramenta web para análise de pressão em manutenções industriais e atendimentos técnicos. Carregue um arquivo CSV, visualize gráficos interativos com detecção automática de picos, e gere relatórios profissionais prontos para impressão em formato A4.

🔗 **Acesse o sistema online:** [https://abl0n.github.io/gasGrafico/](https://abl0n.github.io/gasGrafico/)

> 🔐 **CSP rígida:** `default-src 'none'` + `script-src 'self'` — o app não carrega nada de fora.
>
> 📱 **PWA instalável:** instale como app no desktop ou celular e use **100% offline**.

---

## 🚀 Funcionalidades

### Análise

- 📂 **Upload de CSV**: carregue arquivos com dados de pressão (data/hora e valor).
- 📈 **Gráfico interativo**: canvas nativo com curva de pressão, marcadores coloridos e tooltip.
- 🔴 **Detecção automática de picos**: identifica máximos e mínimos locais (estilo eletrocardiograma) com variação ≥ 5% em relação à pressão de trabalho.
- 🎨 **Paleta de 9 cores por magnitude**: cada pico é colorido conforme a faixa de variação (5%, 10%, 20%, 30%, 35%, 40%, 50%, 60%, 80%+).
- 🟢 **Detecção de estabilidade**: marca início e fim de trechos estáveis (>3 min) com tolerância de ±2% em torno da referência.
- 📊 **Resumo agrupado por faixa**: tabela resumo com contagem de picos por magnitude, % do total e distribuição visual.
- 📋 **Registro de estabilidades**: tabela com horário de início, fim, duração e pressão.

### Relatório

- 🖨️ **Relatório em A4**: geração de relatório formatado para impressão, com logo, dados da manutenção, equipe responsável, gráfico, estatísticas e tabelas.
- 🏷️ **Classificações**: Preventiva, Corretiva, Emergência, Averiguar, Renovação.
- 📐 **Níveis de serviço**: A, B, B-AR, C.
- 📝 **Observações**: campo de texto livre em linha exclusiva no PDF.

### Segurança e portabilidade

- 🔒 **Totalmente offline e seguro**: todos os dados processados localmente. Nenhuma informação sai do navegador.
- 📱 **PWA instalável**: adicione à tela inicial (mobile) ou instale como app (desktop).
- 🌐 **Funciona sem internet** após o primeiro acesso (service worker cacheia tudo).
- 🎯 **Zero dependências externas**: sem CDNs, sem bibliotecas — só HTML, CSS e JS puros.

---

## 🎨 Sistema de Cores dos Picos

Cada pico é classificado por cor conforme sua magnitude (% acima da pressão de referência):

| Cor | Faixa |
|:---:|:---:|
| 🔴 Vermelho | 5% – 9% |
| 🔵 Azul | 10% – 19% |
| 🟠 Laranja | 20% – 29% |
| 🟣 Roxo | 30% – 34% |
| 🟡 Amarelo | 35% – 39% |
| 🟢 Verde | 40% – 49% |
| 🟤 Marrom | 50% – 59% |
| ⚫ Preto | 60% – 79% |
| 💗 Magenta | ≥ 80% |

> 🟢 **Losango verde-escuro** = início/fim de estabilidade (trecho >3 min próximo à referência).

---

## 🛠️ Tecnologias Utilizadas

| Ferramenta | Descrição |
| :--- | :--- |
| **HTML5 / CSS3** | Estrutura e estilização da interface |
| **JavaScript (Vanilla)** | Lógica de processamento, parsing CSV e gráfico |
| **Canvas API** | Renderização do gráfico de pressão (nativo) |
| **Service Worker** | Cache offline-first + PWA instalável |
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

## 🚀 Como usar

### Uso normal (online)

1. Acesse [https://abl0n.github.io/gasGrafico/](https://abl0n.github.io/gasGrafico/)
2. Digite a **pressão de trabalho** (100%) do equipamento
3. Carregue o CSV com os dados de pressão
4. Analise o gráfico, tabelas e estatísticas
5. Clique em **"Imprimir Relatório"** para gerar o PDF

### Instalar como app (recomendado)

1. Acesse o site no **Chrome** ou **Edge**
2. Clique no ícone **"Instalar"** na barra de endereços (ou menu → **Instalar**)
3. O app abre em **janela própria**, com ícone na área de trabalho
4. **Funciona 100% offline** após o primeiro acesso

### Uso offline (após instalar)

1. Desligue a internet
2. Abra o app normalmente
3. Tudo funciona: upload de CSV, gráfico, impressão
4. Os dados **nunca saem** do seu computador

---

## 📦 Como rodar localmente

Por causa da CSP, sirva via HTTP (não abra com `file://`):

```bash
# Python 3
python -m http.server 8000

# ou Node.js
npx serve . -p 8000
```

Acesse `http://localhost:8000`.

> **Nota**: em `localhost` o Chrome considera o contexto seguro e permite o PWA. Para uso em rede local, use HTTPS.

---

## 🗂️ Estrutura do Projeto

```
projeto_gasGrafico/
├── index.html              # Estrutura HTML
├── styles.css              # Estilos (com variáveis CSS)
├── app.js                  # Toda a lógica (zero dependências)
├── manifest.json           # Manifest do PWA
├── service-worker.js       # Cache offline-first
├── icons/
│   ├── icon-192.png        # Ícone PWA (192×192)
│   └── icon-512.png        # Ícone PWA (512×512)
├── .nojekyll               # Desativa Jekyll no GitHub Pages
└── README.md
```

---

## 🧪 Como testar offline

1. Abra o app no Chrome
2. **F12** → aba **Application** → **Service Workers**
3. Marque a opção **Offline** ✅
4. Recarregue a página (**Ctrl+R**)
5. O app deve carregar e funcionar normalmente

---

## 🔄 Atualizando a versão

Quando fizer alterações no app e quiser forçar a atualização nos clientes:

1. Edite os arquivos normalmente
2. **Atualize a versão do cache** em `service-worker.js`:
   ```javascript
   const CACHE_VERSION = 'v1';  →  const CACHE_VERSION = 'v2';
   ```
3. Faça `git push`
4. Usuários verão a mensagem **"Nova versão disponível. Recarregar agora?"**

---

## 📝 Licença

MIT