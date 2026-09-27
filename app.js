'use strict';

/* ================================================================
 * DATA LOGGER - ANÁLISE DE PRESSÃO
 * Zero dependências externas.
 * Módulos: State, Utils, CSVParser, Detector, StatusClassifier,
 *          Responsaveis, Logo, Relatorio, CanvasChart, Tabela,
 *          Processador, App
 * ================================================================ */

/* ----------------------------------------------------------------
 * ESTADO GLOBAL
 * ---------------------------------------------------------------- */
const State = {
    dadosProcessados: false,
    nivelSelecionado: '',
    rawTimes: [],
    rawPressures: [],
    logoDataURL: null,
    nextResponsavelId: 1,
    resizeObserver: null,
    currentChartData: null,
    currentPeaks: [],
    currentStablePoints: [],
    resizeTimeout: null
};

/* ----------------------------------------------------------------
 * UTILITÁRIOS
 * ---------------------------------------------------------------- */
const Utils = {
    extractTimeOnly(fullTime) {
        const m = String(fullTime).match(/(\d{2}:\d{2}:\d{2})/);
        return m ? m[1] : fullTime;
    },

    getPressaoReferencia() {
        const el = document.getElementById('pressaoTrabalho');
        const valor = parseFloat(el.value);
        return Number.isFinite(valor) && valor > 0 ? valor : 0.350;
    },

    calcularDiferencaPercentual(valorPico, pressaoReferencia) {
        const valor = Number(valorPico);
        const ref = Number(pressaoReferencia);
        if (!Number.isFinite(valor) || !Number.isFinite(ref) || ref <= 0) return 0;
        return ((valor - ref) / ref) * 100;
    }
};

/* ----------------------------------------------------------------
 * PARSER CSV (substitui PapaParse)
 * Suporta: vírgula, ponto-e-vírgula, tab, pipe como delimitadores
 * Trata: aspas duplas com escape "" e quebras de linha dentro de campo
 * ---------------------------------------------------------------- */
const CSVParser = {
    /**
     * Detecta o delimitador mais provável olhando a primeira linha.
     */
    detectDelimiter(text) {
        const firstLine = text.split(/\r?\n/, 1)[0] || '';
        const candidates = [',', ';', '\t', '|'];
        let best = ',';
        let bestCount = -1;
        for (const d of candidates) {
            const count = firstLine.split(d).length - 1;
            if (count > bestCount) {
                bestCount = count;
                best = d;
            }
        }
        return bestCount > 0 ? best : ',';
    },

    /**
     * Parse completo do CSV em matriz de strings.
     * Retorna array de arrays: [["h1","h2"], ["v1","v2"], ...]
     */
    parse(text, delimiter) {
        const delim = delimiter || this.detectDelimiter(text);
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        let i = 0;
        const len = text.length;

        // BOM UTF-8: descarta
        if (len > 0 && text.charCodeAt(0) === 0xFEFF) i = 1;

        while (i < len) {
            const ch = text[i];

            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') {
                        // aspas escapada
                        field += '"';
                        i += 2;
                    } else {
                        inQuotes = false;
                        i++;
                    }
                } else {
                    field += ch;
                    i++;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                    i++;
                } else if (ch === delim) {
                    row.push(field);
                    field = '';
                    i++;
                } else if (ch === '\r') {
                    // ignora \r (Windows) — só \n quebra linha
                    i++;
                } else if (ch === '\n') {
                    row.push(field);
                    field = '';
                    if (row.length > 1 || row[0] !== '') rows.push(row);
                    row = [];
                    i++;
                } else {
                    field += ch;
                    i++;
                }
            }
        }
        // último campo / última linha
        row.push(field);
        if (row.length > 1 || row[0] !== '') rows.push(row);

        return rows;
    }
};

/* ----------------------------------------------------------------
 * DETECÇÃO DE PICOS E ESTABILIDADE
 * ---------------------------------------------------------------- */
const Detector = {
    detectPeaks(pressures) {
        if (!Array.isArray(pressures) || pressures.length < 5) return [];

        const HALF_WINDOW = 5;
        const MIN_VARIATION = 5;
        const MIN_DISTANCE = 5;
        const candidates = [];

        for (let i = 2; i < pressures.length - 2; i++) {
            const current = Number(pressures[i]);
            const prev1 = Number(pressures[i - 1]);
            const next1 = Number(pressures[i + 1]);

            if (!Number.isFinite(current) || !Number.isFinite(prev1) || !Number.isFinite(next1)) continue;
            if (!(current > prev1 && current >= next1)) continue;

            const start = Math.max(0, i - HALF_WINDOW);
            const end = Math.min(pressures.length, i + HALF_WINDOW + 1);

            const neighbors = [];
            for (let j = start; j < end; j++) {
                if (j !== i && Number.isFinite(Number(pressures[j]))) {
                    neighbors.push(Number(pressures[j]));
                }
            }
            if (!neighbors.length) continue;

            const localAvg = neighbors.reduce((s, v) => s + v, 0) / neighbors.length;
            if (!(localAvg > 0)) continue;

            const variacaoPercentual = ((current - localAvg) / localAvg) * 100;
            if (variacaoPercentual > MIN_VARIATION) {
                candidates.push({ index: i, value: current, variacaoPercentual, localAvg });
            }
        }

        const filtered = [];
        for (const c of candidates) {
            const last = filtered[filtered.length - 1];
            if (!last || c.index - last.index > MIN_DISTANCE) {
                filtered.push(c);
            } else if (c.value > last.value) {
                filtered[filtered.length - 1] = c;
            }
        }
        return filtered;
    },

    detectStabilityStarts(pressures, times) {
        const stablePoints = [];
        const THRESHOLD = 2.0;

        for (let i = 2; i < pressures.length - 2; i++) {
            const window = pressures.slice(i - 2, i + 3);
            const maxVal = Math.max(...window);
            const minVal = Math.min(...window);
            const variacao = maxVal > 0 ? ((maxVal - minVal) / maxVal) * 100 : 0;

            if (variacao <= THRESHOLD) {
                const last = stablePoints[stablePoints.length - 1];
                if (!last || (i - last.index) > 10) {
                    stablePoints.push({
                        index: i,
                        time: times[i],
                        value: pressures[i],
                        type: 'início de estabilidade'
                    });
                }
            }
        }
        return stablePoints;
    }
};

/* ----------------------------------------------------------------
 * CLASSIFICADOR DE STATUS
 * ---------------------------------------------------------------- */
const StatusClassifier = {
    HIGH_LEVELS: [
        [100, 'status-alto-100', 'ALTO 100%+'],
        [90, 'status-alto-90', 'ALTO 90%'],
        [80, 'status-alto-80', 'ALTO 80%'],
        [70, 'status-alto-70', 'ALTO 70%'],
        [60, 'status-alto-60', 'ALTO 60%'],
        [50, 'status-alto-50', 'ALTO 50%'],
        [40, 'status-alto-40', 'ALTO 40%'],
        [30, 'status-alto-30', 'ALTO 30%'],
        [20, 'status-alto-20', 'ALTO 20%'],
        [10, 'status-alto-10', 'ALTO 10%'],
        [5, 'status-alto-10', 'ALTO 5%']
    ],
    LOW_LEVELS: [
        [100, 'status-baixo-100', 'BAIXO 100%+'],
        [90, 'status-baixo-90', 'BAIXO 90%'],
        [80, 'status-baixo-80', 'BAIXO 80%'],
        [70, 'status-baixo-70', 'BAIXO 70%'],
        [60, 'status-baixo-60', 'BAIXO 60%'],
        [50, 'status-baixo-50', 'BAIXO 50%'],
        [40, 'status-baixo-40', 'BAIXO 40%'],
        [30, 'status-baixo-30', 'BAIXO 30%'],
        [20, 'status-baixo-20', 'BAIXO 20%'],
        [10, 'status-baixo-10', 'BAIXO 10%'],
        [5, 'status-baixo-10', 'BAIXO 5%']
    ],

    get(percentual) {
        if (percentual >= 5) {
            const m = this.HIGH_LEVELS.find(([lim]) => percentual >= lim);
            return { class: m[1], text: `🔴 ${m[2]}` };
        }
        if (percentual <= -5) {
            const abs = Math.abs(percentual);
            const m = this.LOW_LEVELS.find(([lim]) => abs >= lim);
            return { class: m[1], text: `📉 ${m[2]}` };
        }
        return { class: 'status-normal', text: '✓ NORMAL' };
    }
};

/* ----------------------------------------------------------------
 * RESPONSÁVEIS
 * ---------------------------------------------------------------- */
const Responsaveis = {
    grid: null,
    reportGrid: null,
    reportSection: null,

    init() {
        this.grid = document.getElementById('responsaveisGrid');
        this.reportGrid = document.getElementById('responsaveisReportGrid');
        this.reportSection = document.getElementById('responsaveisReport');

        document.getElementById('btnAddResponsavel')
            .addEventListener('click', () => this.adicionar());

        this.grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-responsavel');
            if (!btn) return;
            const card = btn.closest('.responsavel-card');
            if (card) {
                card.remove();
                this.atualizarRelatorio();
            }
        });

        this.grid.addEventListener('input', () => this.atualizarRelatorio());

        this.adicionar();
    },

    adicionar() {
        const id = State.nextResponsavelId++;
        const card = document.createElement('div');
        card.className = 'responsavel-card';
        card.dataset.id = String(id);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-remove-responsavel';
        btn.textContent = 'Remover';

        const row = document.createElement('div');
        row.className = 'responsavel-row';

        const fields = [
            { cls: 'resp-nome', placeholder: 'Nome completo' },
            { cls: 'resp-cargo', placeholder: 'Cargo / Função' },
            { cls: 'resp-registro', placeholder: 'Registro / Matrícula' }
        ];

        for (const f of fields) {
            const wrap = document.createElement('div');
            wrap.className = 'responsavel-field';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = f.cls;
            input.placeholder = f.placeholder;

            wrap.appendChild(input);
            row.appendChild(wrap);
        }

        card.append(btn, row);
        this.grid.appendChild(card);
        this.atualizarRelatorio();
    },

    coletar() {
        return Array.from(this.grid.querySelectorAll('.responsavel-card'))
            .map(card => ({
                nome: card.querySelector('.resp-nome')?.value || '',
                cargo: card.querySelector('.resp-cargo')?.value || '',
                registro: card.querySelector('.resp-registro')?.value || ''
            }))
            .filter(r => r.nome || r.cargo || r.registro);
    },

    atualizarRelatorio() {
        const lista = this.coletar();

        if (lista.length === 0) {
            this.reportSection.hidden = true;
            this.reportGrid.replaceChildren();
            return;
        }

        this.reportSection.hidden = false;

        const frag = document.createDocumentFragment();
        for (const r of lista) {
            const card = document.createElement('div');
            card.className = 'responsavel-report-card';

            const nome = document.createElement('div');
            nome.className = 'nome';
            nome.textContent = r.nome || '—';

            const cargo = document.createElement('div');
            cargo.className = 'cargo';
            cargo.textContent = r.cargo || '—';

            const reg = document.createElement('div');
            reg.className = 'registro';
            reg.textContent = r.registro || '—';

            card.append(nome, cargo, reg);
            frag.appendChild(card);
        }
        this.reportGrid.replaceChildren(frag);
    }
};

/* ----------------------------------------------------------------
 * LOGO
 * ---------------------------------------------------------------- */
const Logo = {
    MAX_SIZE: 2 * 1024 * 1024,

    init() {
        this.input = document.getElementById('logoInput');
        this.btnAdd = document.getElementById('btnAdicionarLogo');
        this.btnRemove = document.getElementById('btnRemoverLogo');
        this.preview = document.getElementById('logoPreview');
        this.reportLogo = document.getElementById('reportLogo');

        this.btnAdd.addEventListener('click', () => this.input.click());

        this.btnRemove.addEventListener('click', () => {
            State.logoDataURL = null;
            this.input.value = '';
            this.render();
        });

        this.input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file || !file.type.startsWith('image/')) return;

            if (file.size > this.MAX_SIZE) {
                alert(`Logo muito grande. Máximo: ${this.MAX_SIZE / 1024 / 1024} MB`);
                this.input.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => {
                State.logoDataURL = ev.target.result;
                this.render();
            };
            reader.onerror = () => alert('Erro ao ler a imagem.');
            reader.readAsDataURL(file);
        });

        this.render();
    },

    render() {
        if (State.logoDataURL) {
            this.preview.replaceChildren(this._buildImg());
            this.reportLogo.replaceChildren(this._buildImg());
            this.btnRemove.hidden = false;
        } else {
            const ph = document.createElement('div');
            ph.className = 'logo-placeholder';
            ph.textContent = 'Logo da Empresa';
            this.preview.replaceChildren(ph);
            this.reportLogo.replaceChildren();
            this.btnRemove.hidden = true;
        }
    },

    _buildImg() {
        const img = document.createElement('img');
        img.src = State.logoDataURL;
        img.alt = 'Logo';
        return img;
    }
};

/* ----------------------------------------------------------------
 * RELATÓRIO / FORMULÁRIO
 * ---------------------------------------------------------------- */
const Relatorio = {
    els: {},

    init() {
        this.els = {
            equipamento: document.getElementById('equipamento'),
            endereco: document.getElementById('endereco'),
            pressao: document.getElementById('pressaoTrabalho'),
            pressaoDestaque: document.getElementById('pressaoDestaqueValor'),
            obs: document.getElementById('obs'),
            obsItem: document.getElementById('obsReportItem'),
            reportObs: document.getElementById('reportObs'),
            reportEquip: document.getElementById('reportEquipamento'),
            reportEnd: document.getElementById('reportEndereco'),
            reportPressao: document.getElementById('reportPressaoTrabalho'),
            reportClass: document.getElementById('reportClassificacao'),
            reportNivel: document.getElementById('reportNivel'),
            reportDataHora: document.getElementById('reportDataHora'),
            reportHeader: document.getElementById('reportHeader')
        };

        this.els.pressao.addEventListener('input', () => this.atualizarPressaoDestaque());
        this.els.obs.addEventListener('input', () => this.atualizarObservacoes());

        [this.els.equipamento, this.els.endereco, this.els.pressao].forEach(el => {
            el.addEventListener('input', () => this.atualizarCabecalho());
        });

        document.querySelectorAll('input[name="tipoManutencao"]').forEach(el => {
            el.addEventListener('change', () => this.atualizarCabecalho());
        });

        document.querySelectorAll('.nivel-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nivel-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                State.nivelSelecionado = btn.dataset.nivel;
                this.atualizarCabecalho();
            });
        });

        this.atualizarPressaoDestaque();
    },

    atualizarPressaoDestaque() {
        const valor = parseFloat(this.els.pressao.value);
        const valido = Number.isFinite(valor) && valor > 0;
        this.els.pressao.classList.toggle('input-invalid', !valido);
        this.els.pressaoDestaque.textContent = valido
            ? `${valor.toFixed(3)} Bar`
            : 'Valor inválido';
    },

    atualizarObservacoes() {
        const v = this.els.obs.value.trim();
        if (v) {
            this.els.reportObs.textContent = v;
            this.els.reportObs.classList.add('multiline');
            this.els.obsItem.hidden = false;
        } else {
            this.els.obsItem.hidden = true;
        }
    },

    getClassificacaoTexto() {
        const checked = document.querySelector('input[name="tipoManutencao"]:checked');
        return checked ? checked.value : 'Não informado';
    },

    atualizarCabecalho() {
        this.els.reportEquip.textContent = this.els.equipamento.value || '—';
        this.els.reportEnd.textContent = this.els.endereco.value || '—';
        this.els.reportPressao.textContent = this.els.pressao.value
            ? `${this.els.pressao.value} Bar`
            : '—';
        this.els.reportClass.textContent = this.getClassificacaoTexto();

        const nivel = State.nivelSelecionado;
        this.els.reportNivel.textContent = nivel ? `Nível ${nivel}` : '—';
        this.els.reportNivel.className = `value classification ${nivel || ''}`;

        this.els.reportDataHora.textContent = new Date().toLocaleString('pt-BR');
        this.atualizarObservacoes();
    },

    limpar() {
        this.els.equipamento.value = '';
        this.els.endereco.value = '';
        this.els.pressao.value = '0.350';
        this.els.obs.value = '';

        document.querySelectorAll('input[name="tipoManutencao"]').forEach(el => { el.checked = false; });
        document.querySelectorAll('.nivel-btn').forEach(b => b.classList.remove('selected'));

        State.nivelSelecionado = '';
        this.atualizarPressaoDestaque();
        this.atualizarObservacoes();

        if (!State.dadosProcessados) {
            this.els.reportHeader.hidden = true;
        } else {
            this.atualizarCabecalho();
        }
    }
};

/* ----------------------------------------------------------------
 * CANVAS CHART (substitui Chart.js)
 * Gráfico de linha + pontos de pico/estabilidade, com tooltip e eixo.
 * Sem dependências externas — desenha direto no <canvas> 2D.
 * ---------------------------------------------------------------- */
const CanvasChart = {
    // Margens internas (espaço para eixos)
    PAD: { top: 30, right: 30, bottom: 60, left: 70 },
    COLORS: {
        line: '#6caddc',
        lineFill: 'rgba(108,173,220,0.12)',
        grid: '#e2e8f0',
        axis: '#cbd5e1',
        text: '#5a6e7e',
        textTitle: '#7a8e9e',
        peak: '#c07070',
        peakBorder: '#a05050',
        stable: '#2c9e6e',
        stableBorder: '#1a6e4a'
    },

    // Referências internas
    canvas: null,
    ctx: null,
    tooltip: null,
    _boundMove: null,
    _boundLeave: null,

    init() {
        this.canvas = document.getElementById('pressureChart');
        this.ctx = this.canvas.getContext('2d');

        // Tooltip: elemento flutuante no <body>
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'chart-tooltip';
        this.tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(this.tooltip);

        this._boundMove = (e) => this._onMouseMove(e);
        this._boundLeave = () => this._hideTooltip();
        this.canvas.addEventListener('mousemove', this._boundMove);
        this.canvas.addEventListener('mouseleave', this._boundLeave);
        // Touch: mostra tooltip no toque
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length) this._onMouseMove(e.touches[0]);
        }, { passive: true });
        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length) this._onMouseMove(e.touches[0]);
        }, { passive: true });
        this.canvas.addEventListener('touchend', this._boundLeave);
    },

    /**
     * Ajusta a resolução interna do canvas ao tamanho exibido (devicePixelRatio).
     */
    _fitCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const cssW = Math.max(300, rect.width);
        const cssH = Math.max(200, rect.height || 450);
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w: cssW, h: cssH };
    },

    render(times, lineData, peakData, stableData) {
        if (!this.canvas || !times.length) return;

        const { w, h } = this._fitCanvas();
        const { PAD, COLORS } = this;
        const plotW = w - PAD.left - PAD.right;
        const plotH = h - PAD.top - PAD.bottom;

        // Limpa
        this.ctx.clearRect(0, 0, w, h);

        // Determina limites Y (incluindo pontos de pico/estabilidade)
        const vals = lineData.filter(Number.isFinite);
        let minY = Math.min(...vals);
        let maxY = Math.max(...vals);
        const range = Math.max(maxY - minY, 0.001);
        const margin = range * 0.1;
        minY = Math.max(0, minY - margin);
        maxY = maxY + margin;

        const xOf = (i) => PAD.left + (i / (lineData.length - 1)) * plotW;
        const yOf = (v) => PAD.top + plotH - ((v - minY) / (maxY - minY)) * plotH;

        // Grade horizontal + labels Y
        this.ctx.font = '11px "Segoe UI", sans-serif';
        this.ctx.fillStyle = COLORS.text;
        this.ctx.strokeStyle = COLORS.grid;
        this.ctx.lineWidth = 1;
        const ySteps = 5;
        for (let s = 0; s <= ySteps; s++) {
            const v = minY + ((maxY - minY) * s) / ySteps;
            const y = yOf(v);
            this.ctx.beginPath();
            this.ctx.moveTo(PAD.left, y);
            this.ctx.lineTo(PAD.left + plotW, y);
            this.ctx.stroke();
            this.ctx.textAlign = 'right';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(v.toFixed(3), PAD.left - 8, y);
        }

        // Eixos
        this.ctx.strokeStyle = COLORS.axis;
        this.ctx.beginPath();
        this.ctx.moveTo(PAD.left, PAD.top);
        this.ctx.lineTo(PAD.left, PAD.top + plotH);
        this.ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
        this.ctx.stroke();

        // Labels X (limita para não poluir)
        const maxTicks = 10;
        const step = Math.max(1, Math.ceil(lineData.length / maxTicks));
        this.ctx.fillStyle = COLORS.text;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';
        for (let i = 0; i < lineData.length; i += step) {
            const x = xOf(i);
            const label = Utils.extractTimeOnly(times[i]);
            this.ctx.fillText(label, x, PAD.top + plotH + 8);
        }

        // Título do eixo Y
        this.ctx.save();
        this.ctx.translate(18, PAD.top + plotH / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.fillStyle = COLORS.textTitle;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.font = '12px "Segoe UI", sans-serif';
        this.ctx.fillText('Pressão (Bar)', 0, 0);
        this.ctx.restore();

        // Linha + preenchimento
        this.ctx.beginPath();
        for (let i = 0; i < lineData.length; i++) {
            const x = xOf(i);
            const y = yOf(lineData[i]);
            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        }
        // Fecha área sob a linha
        const pathEnd = { x: xOf(lineData.length - 1), y: PAD.top + plotH };
        const pathStart = { x: xOf(0), y: PAD.top + plotH };
        this.ctx.lineTo(pathEnd.x, pathEnd.y);
        this.ctx.lineTo(pathStart.x, pathStart.y);
        this.ctx.closePath();
        this.ctx.fillStyle = COLORS.lineFill;
        this.ctx.fill();

        // Redesenha só a linha por cima
        this.ctx.beginPath();
        for (let i = 0; i < lineData.length; i++) {
            const x = xOf(i);
            const y = yOf(lineData[i]);
            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        }
        this.ctx.strokeStyle = COLORS.line;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Pontos de pico
        for (let i = 0; i < peakData.length; i++) {
            if (peakData[i] == null) continue;
            this._drawMarker(xOf(i), yOf(peakData[i]), COLORS.peak, COLORS.peakBorder, 7, 'circle');
        }

        // Pontos de estabilidade (losango)
        for (let i = 0; i < stableData.length; i++) {
            if (stableData[i] == null) continue;
            this._drawMarker(xOf(i), yOf(stableData[i]), COLORS.stable, COLORS.stableBorder, 8, 'diamond');
        }

        // Guarda dados para uso no tooltip
        this._last = { times, lineData, peakData, stableData, xOf, yOf, plotW, plotH, PAD };
    },

    _drawMarker(x, y, fill, border, size, shape) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = fill;
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;

        if (shape === 'diamond') {
            ctx.beginPath();
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size, y);
            ctx.lineTo(x, y + size);
            ctx.lineTo(x - size, y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    },

    _onMouseMove(evt) {
        if (!this._last) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;

        // Encontra o índice mais próximo no eixo X
        const { times, lineData, peakData, stableData, xOf, PAD, plotW, plotH } = this._last;
        if (x < PAD.left || x > PAD.left + plotW) return this._hideTooltip();
        if (y < PAD.top || y > PAD.top + plotH) return this._hideTooltip();

        let closest = 0;
        let minDist = Infinity;
        for (let i = 0; i < lineData.length; i++) {
            const d = Math.abs(xOf(i) - x);
            if (d < minDist) { minDist = d; closest = i; }
        }

        const pressaoRef = Utils.getPressaoReferencia();
        const diff = Utils.calcularDiferencaPercentual(lineData[closest], pressaoRef);
        const sinal = diff >= 0 ? '+' : '';

        let extra = '';
        if (peakData[closest] != null) {
            extra = `\n📊 Status: ${StatusClassifier.get(diff).text}`;
        } else if (stableData[closest] != null) {
            extra = '\n📍 Início de período estável';
        }

        const texto =
            `Pressão: ${lineData[closest].toFixed(4)} Bar\n` +
            `⏱️ ${times[closest]}\n` +
            `📊 Diferença: ${sinal}${diff.toFixed(2)}%` +
            extra;

        this._showTooltip(evt.clientX, evt.clientY, texto);
    },

    _showTooltip(clientX, clientY, texto) {
        this.tooltip.textContent = texto;
        this.tooltip.style.left = clientX + 'px';
        this.tooltip.style.top = (clientY - 10) + 'px';
        this.tooltip.classList.add('visible');
    },

    _hideTooltip() {
        this.tooltip.classList.remove('visible');
    },

    recriar() {
        if (!State.currentChartData) return;
        if (document.getElementById('chartContainer').hidden) return;
        const d = State.currentChartData;
        this.render(d.times, d.lineData, d.peakData, d.stableData);
    },

    destruir() {
        if (!this.canvas) return;
        const { w, h } = this._fitCanvas();
        this.ctx.clearRect(0, 0, w, h);
        this._last = null;
        this._hideTooltip();
    }
};

/* ----------------------------------------------------------------
 * TABELA DE PICOS + ESTATÍSTICAS
 * ---------------------------------------------------------------- */
const Tabela = {
    renderPicos(peaks, times) {
        const badge = document.getElementById('picosCountBadge');
        const container = document.getElementById('picosTableContainer');
        const tableDiv = document.getElementById('picosTable');

        badge.textContent = `${peaks.length} pico${peaks.length !== 1 ? 's' : ''}`;
        container.hidden = false;

        if (peaks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '⚠️ Nenhum pico de pressão com variação > 5% foi detectado nos dados.';
            tableDiv.replaceChildren(empty);
            return;
        }

        const pressaoRef = Utils.getPressaoReferencia();
        const table = document.createElement('table');

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['#', 'Horário', 'Pressão (Bar)', 'Diferença (%)', 'Referência (Bar)', 'Status']) {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        peaks.forEach((pico, idx) => {
            const timeOnly = Utils.extractTimeOnly(times[pico.index]);
            const diff = Utils.calcularDiferencaPercentual(pico.value, pressaoRef);
            const sinal = diff >= 0 ? '+' : '';
            const cssClass = diff >= 0 ? 'diferenca-positiva' : 'diferenca-negativa';
            const status = StatusClassifier.get(diff);

            const tr = document.createElement('tr');
            if (Math.abs(diff) > 80) tr.classList.add('row-critical');

            const tdIdx = document.createElement('td');
            const strongIdx = document.createElement('strong');
            strongIdx.textContent = String(idx + 1);
            tdIdx.appendChild(strongIdx);
            tr.appendChild(tdIdx);

            const tdTime = document.createElement('td');
            tdTime.textContent = timeOnly;
            tr.appendChild(tdTime);

            const tdPress = document.createElement('td');
            tdPress.className = cssClass;
            const strongPress = document.createElement('strong');
            strongPress.textContent = pico.value.toFixed(4);
            tdPress.appendChild(strongPress);
            tr.appendChild(tdPress);

            const tdDiff = document.createElement('td');
            tdDiff.className = cssClass;
            const strongDiff = document.createElement('strong');
            strongDiff.textContent = `${sinal}${diff.toFixed(2)}%`;
            tdDiff.appendChild(strongDiff);
            tr.appendChild(tdDiff);

            const tdRef = document.createElement('td');
            tdRef.className = 'referencia';
            tdRef.textContent = pressaoRef.toFixed(3);
            tr.appendChild(tdRef);

            const tdStatus = document.createElement('td');
            const span = document.createElement('span');
            span.className = `status-badge ${status.class}`;
            span.textContent = status.text;
            tdStatus.appendChild(span);
            tr.appendChild(tdStatus);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableDiv.replaceChildren(table);
    },

    renderStats(pressures, peaks, stablePoints) {
        const maxP = Math.max(...pressures);
        const minP = Math.min(...pressures);
        const avgP = pressures.reduce((a, b) => a + b, 0) / pressures.length;
        const maxPeak = peaks.length ? Math.max(...peaks.map(p => p.value)) : 0;
        const pressaoRef = Utils.getPressaoReferencia();
        const maxDiff = Utils.calcularDiferencaPercentual(maxPeak, pressaoRef);

        const stats = [
            { value: maxP.toFixed(3), label: 'Máxima Geral' },
            { value: minP.toFixed(3), label: 'Mínima Geral' },
            { value: avgP.toFixed(3), label: 'Média' },
            { value: maxPeak.toFixed(3), label: 'Maior Pico', peak: true },
            { value: `${maxDiff >= 0 ? '+' : ''}${maxDiff.toFixed(2)}%`, label: 'Variação', peak: true },
            { value: peaks.length, label: 'Total Picos' },
            { value: stablePoints.length, label: 'Estabilidades' }
        ];

        const row = document.getElementById('statsRow');
        const frag = document.createDocumentFragment();

        for (const s of stats) {
            const box = document.createElement('div');
            box.className = 'stat-box';

            const val = document.createElement('div');
            val.className = 'stat-value' + (s.peak ? ' peak' : '');
            val.textContent = String(s.value);

            const lbl = document.createElement('div');
            lbl.className = 'stat-label';
            lbl.textContent = s.label;

            box.append(val, lbl);
            frag.appendChild(box);
        }

        row.replaceChildren(frag);
        row.hidden = false;
    }
};

/* ----------------------------------------------------------------
 * PROCESSAMENTO
 * ---------------------------------------------------------------- */
const Processador = {
    MAX_FILE_SIZE: 50 * 1024 * 1024,

    processarTexto(text) {
        this._esconderErro();
        App.limparDados();

        if (!text || typeof text !== 'string') {
            this._erro('Arquivo vazio ou inválido.');
            return;
        }

        let rows;
        try {
            rows = CSVParser.parse(text);
        } catch (err) {
            this._erro('Erro ao analisar CSV: ' + err.message);
            return;
        }

        if (!Array.isArray(rows) || rows.length < 2) {
            this._erro('Arquivo vazio ou com poucos dados');
            return;
        }

        // Detecta se a primeira linha é cabeçalho
        const firstRow = rows[0];
        const firstPressure = firstRow.length >= 2
            ? parseFloat(String(firstRow[1]).replace(',', '.').trim())
            : NaN;
        const startIndex = Number.isFinite(firstPressure) ? 0 : 1;

        const times = [];
        const pressures = [];

        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) continue;

            const timeStr = row[0] != null ? String(row[0]).trim() : '';
            const pressStr = row[1] != null ? String(row[1]).replace(',', '.').trim() : '';
            const press = parseFloat(pressStr);

            if (timeStr !== '' && Number.isFinite(press)) {
                times.push(timeStr);
                pressures.push(press);
            }
        }

        if (times.length === 0) {
            this._erro('Não foi possível encontrar dados. Verifique o formato do CSV.');
            return;
        }

        State.rawTimes = times;
        State.rawPressures = pressures;
        State.currentPeaks = Detector.detectPeaks(pressures);
        State.currentStablePoints = Detector.detectStabilityStarts(pressures, times);

        const peakData = new Array(pressures.length).fill(null);
        State.currentPeaks.forEach(p => { peakData[p.index] = p.value; });

        const stableData = new Array(pressures.length).fill(null);
        State.currentStablePoints.forEach(p => { stableData[p.index] = p.value; });

        Tabela.renderPicos(State.currentPeaks, times);
        Tabela.renderStats(pressures, State.currentPeaks, State.currentStablePoints);

        State.currentChartData = {
            times: [...times],
            lineData: [...pressures],
            peakData: [...peakData],
            stableData: [...stableData]
        };

        document.getElementById('chartContainer').hidden = false;
        CanvasChart.render(times, pressures, peakData, stableData);
        this._updateLegend(times);

        State.dadosProcessados = true;
        Relatorio.atualizarCabecalho();
        document.getElementById('reportHeader').hidden = false;

        if (document.querySelectorAll('.responsavel-card').length === 0) {
            Responsaveis.adicionar();
        }

        const fileInfo = document.getElementById('fileInfo');
        fileInfo.textContent += ` — ${times.length.toLocaleString('pt-BR')} medições processadas`;
    },

    _updateLegend(times) {
        if (!times.length) return;
        const primeiro = times[0];
        const ultimo = times[times.length - 1];
        const dataInicio = primeiro.split(' ')[0] || primeiro;
        const dataFim = ultimo.split(' ')[0] || ultimo;

        document.getElementById('periodoInicio').textContent =
            `${dataInicio} ${Utils.extractTimeOnly(primeiro)}`;
        document.getElementById('periodoFim').textContent =
            `${dataFim} ${Utils.extractTimeOnly(ultimo)}`;
        document.getElementById('chartLegend').hidden = false;
    },

    _erro(msg) {
        const el = document.getElementById('errorMsg');
        el.textContent = msg;
        el.hidden = false;

        document.getElementById('chartContainer').hidden = true;
        document.getElementById('chartLegend').hidden = true;
        document.getElementById('picosTableContainer').hidden = true;
        document.getElementById('statsRow').hidden = true;
        State.dadosProcessados = false;
    },

    _esconderErro() {
        document.getElementById('errorMsg').hidden = true;
    }
};

/* ----------------------------------------------------------------
 * APP (orquestração)
 * ---------------------------------------------------------------- */
const App = {
    init() {
        Responsaveis.init();
        Logo.init();
        Relatorio.init();
        CanvasChart.init();
        this._bindUpload();
        this._bindAcoes();
        this._setupResize();
    },

    _bindUpload() {
        const input = document.getElementById('csvFile');
        const btn = document.getElementById('uploadLabelBtn');
        const fileInfo = document.getElementById('fileInfo');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            input.click();
        });

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > Processador.MAX_FILE_SIZE) {
                alert(`Arquivo muito grande! Limite: 50 MB. (Atual: ${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                input.value = '';
                fileInfo.textContent = 'Nenhum arquivo selecionado';
                return;
            }

            fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(2)} KB)`;

            const reader = new FileReader();
            reader.onload = (ev) => {
                Processador.processarTexto(String(ev.target.result || ''));
            };
            reader.onerror = () => Processador._erro('Erro ao ler o arquivo.');
            reader.readAsText(file, 'UTF-8');
        });
    },

    _bindAcoes() {
        document.getElementById('btnLimparFormulario')
            .addEventListener('click', () => {
                Relatorio.limpar();
                Responsaveis.grid.replaceChildren();
                State.nextResponsavelId = 1;
                Responsaveis.adicionar();
            });

        document.getElementById('btnLimparDados')
            .addEventListener('click', () => this.limparDados());

        document.getElementById('btnImprimir')
            .addEventListener('click', () => this.imprimir());
    },

    limparDados() {
        CanvasChart.destruir();
        document.getElementById('chartContainer').hidden = true;
        document.getElementById('chartLegend').hidden = true;
        document.getElementById('picosTableContainer').hidden = true;
        document.getElementById('statsRow').hidden = true;
        document.getElementById('reportHeader').hidden = true;
        document.getElementById('fileInfo').textContent = 'Nenhum arquivo selecionado';
        document.getElementById('errorMsg').hidden = true;
        document.getElementById('csvFile').value = '';

        State.dadosProcessados = false;
        State.rawTimes = [];
        State.rawPressures = [];
        State.currentChartData = null;
        State.currentPeaks = [];
        State.currentStablePoints = [];
    },

    imprimir() {
        if (!State.dadosProcessados) {
            alert('Carregue um arquivo CSV primeiro!');
            return;
        }

        const ref = parseFloat(document.getElementById('pressaoTrabalho').value);
        if (!Number.isFinite(ref) || ref <= 0) {
            alert('Informe uma Pressão de Trabalho maior que zero antes de imprimir.');
            document.getElementById('pressaoTrabalho').focus();
            return;
        }

        Relatorio.atualizarCabecalho();
        // Redesenha o gráfico antes de imprimir para garantir resolução correta
        CanvasChart.recriar();
        setTimeout(() => window.print(), 200);
    },

    _setupResize() {
        const debounced = () => {
            if (State.resizeTimeout) clearTimeout(State.resizeTimeout);
            State.resizeTimeout = setTimeout(() => CanvasChart.recriar(), 150);
        };

        if (State.resizeObserver) State.resizeObserver.disconnect();
        State.resizeObserver = new ResizeObserver(debounced);

        const container = document.getElementById('chartContainer');
        if (container) State.resizeObserver.observe(container);

        window.addEventListener('resize', debounced);
    }
};

/* ----------------------------------------------------------------
 * BOOT
 * ---------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => App.init());